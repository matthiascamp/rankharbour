const MAX_BYTES = 200000;
export class EditorError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
export function editablePath(path) {
  return typeof path === 'string' && path.length <= 500 &&
    !path.split('/').some(p => !p || p === '.' || p === '..' || p.startsWith('.')) &&
    !/(^|\/)(node_modules|vendor|dist|build)(\/|$)/i.test(path) &&
    /\.(html?|jsx?|tsx?|css|scss|json|md|mdx|xml|txt|vue|svelte|astro)$/i.test(path) &&
    !/(^|\/)(package-lock\.json|credentials[^/]*|secrets[^/]*|[^/]*\.key)$/i.test(path);
}
export function createGithub(token, fetcher = fetch) {
  return async (path, method = 'GET', body) => {
    const response = await fetcher(`https://api.github.com${path}`, {
      method, redirect: 'error', signal: AbortSignal.timeout(15000),
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2026-03-10', 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) {
      const messages = {401:'The GitHub token is invalid or expired.',403:'GitHub denied access. Check repository permissions or rate limits.',404:'Repository, branch or file not found. Check the token has access.',409:'The repository changed. Reconnect and reload before publishing.',422:'GitHub could not accept this change. Check repository settings.'};
      throw new EditorError(messages[response.status] || 'GitHub is temporarily unavailable.', response.status);
    }
    return response.json();
  };
}
export async function editRepository(input, github, uuid = () => crypto.randomUUID()) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(input.repo || '')) throw new EditorError('Enter a repository as owner/repository.');
  const base = `/repos/${input.repo}`;
  const repo = await github(base);
  if (repo.archived || repo.disabled || !repo.permissions?.push) throw new EditorError('A token with write access to this repository is required.',403);
  const branch = repo.default_branch;
  const head = await github(`${base}/git/ref/heads/${encodeURIComponent(branch)}`);
  const headSha = head.object.sha;
  if (input.action === 'connect') {
    const tree = await github(`${base}/git/trees/${headSha}?recursive=1`);
    if (tree.truncated) throw new EditorError('This repository is too large to list completely. Connect a smaller website repository.');
    return { repo: repo.full_name, branch, headSha, files: tree.tree.filter(f => f.type === 'blob' && f.mode !== '120000' && f.size <= MAX_BYTES && editablePath(f.path)).map(f => f.path) };
  }
  if (!editablePath(input.path)) throw new EditorError('Choose a supported website source file.');
  if (!/^[a-f0-9]{40}$/.test(input.headSha || '')) throw new EditorError('Reconnect the repository first.');
  if (headSha !== input.headSha) throw new EditorError('The repository changed since you connected. Reconnect and reload your file before publishing.',409);
  const commit = await github(`${base}/git/commits/${headSha}`);
  const sourceTree = await github(`${base}/git/trees/${commit.tree.sha}?recursive=1`);
  const entry = sourceTree.tree.find(f => f.path === input.path);
  if (sourceTree.truncated || !entry || entry.type !== 'blob' || !['100644','100755'].includes(entry.mode)) throw new EditorError('Choose a regular source file; symbolic links are excluded.');
  const filePath = input.path.split('/').map(encodeURIComponent).join('/');
  const file = await github(`${base}/contents/${filePath}?ref=${headSha}`);
  if (file.type !== 'file' || file.encoding !== 'base64' || file.size > MAX_BYTES) throw new EditorError('Only text files smaller than 200 KB can be edited.');
  const bytes = Uint8Array.from(atob(file.content.replace(/\s/g,'')), c => c.charCodeAt(0));
  let original;
  try { original = new TextDecoder('utf-8',{fatal:true}).decode(bytes); } catch { throw new EditorError('This file is not UTF-8 text.'); }
  if (original.includes('\0')) throw new EditorError('Binary files cannot be edited.');
  if (input.action === 'read') return { content: original, path: input.path };
  if (input.action !== 'publish') throw new EditorError('Unknown site editor action.');
  if (typeof input.content !== 'string' || new TextEncoder().encode(input.content).length > MAX_BYTES || input.content.includes('\0')) throw new EditorError('The edited file must be UTF-8 text smaller than 200 KB.');
  if (input.content === original) throw new EditorError('Make a change before publishing.');
  const title = String(input.message || '').trim();
  if (!title || title.length > 120 || /[\r\n]/.test(title)) throw new EditorError('Enter a change summary of 1–120 characters.');
  const blob = await github(`${base}/git/blobs`,'POST',{content:input.content,encoding:'utf-8'});
  const tree = await github(`${base}/git/trees`,'POST',{base_tree:commit.tree.sha,tree:[{path:input.path,mode:entry.mode,type:'blob',sha:blob.sha}]});
  const saved = await github(`${base}/git/commits`,'POST',{message:title,tree:tree.sha,parents:[headSha]});
  const newBranch = `rankharbour/seo-${uuid()}`;
  await github(`${base}/git/refs`,'POST',{ref:`refs/heads/${newBranch}`,sha:saved.sha});
  const branchUrl = `https://github.com/${repo.full_name}/tree/${newBranch}`;
  try {
    const pr = await github(`${base}/pulls`,'POST',{title,head:newBranch,base:branch,body:`Website update prepared in RankHarbour.\n\nChanged file: ${input.path}\n\nReview the diff and deployment preview before merging.`});
    return { url:pr.html_url, branch:newBranch, message:'Changes committed. Review your pull request on GitHub before merging.' };
  } catch {
    return { url:branchUrl, branch:newBranch, message:'Changes committed to a new branch, but the pull request could not be opened. Open this branch on GitHub to create it manually.' };
  }
}
