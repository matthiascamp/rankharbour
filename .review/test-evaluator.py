from pathlib import Path
exec((Path(__file__).parent/'test-auth.py').read_text().split('with sync_playwright() as p:')[0])
payload={'url':'https://example.com/','finalUrl':'https://example.com/','status':200,'checkedAt':'2026-10-05T00:00:00Z',
 'score':50,'summary':{'passed':0,'warnings':1,'failed':0},
 'checks':[{'id':'title','label':'Page title','status':'warn','detail':'<img src=x onerror=alert(1)>','recommendation':'Use a useful title.'}],
 'metrics':{'title':'Example','description':'','h1Count':1,'wordCount':30,'imageCount':0,'missingAltCount':0,'internalLinks':1,'externalLinks':0},
 'limitations':['Source HTML only.']}
mode='success'
held=[]
def function(route):
    if mode=='hold': held.append(route); return
    if mode=='error':route.fulfill(status=422,json={'error':'This website blocks automated checks.'});return
    route.fulfill(json=payload)
with sync_playwright() as p:
 b=p.chromium.launch();c=b.new_context(viewport={'width':390,'height':844},reduced_motion='reduce',accept_downloads=True)
 c.route('**/auth/v1/**',api);c.route('**/functions/v1/seo-evaluate',function)
 pg=c.new_page();errors=[];pg.on('pageerror',lambda e:errors.append(str(e)));pg.goto(BASE+'account.html')
 pg.locator('#signin-email').fill(user['email']);pg.locator('#signin-password').fill('Password123!');pg.locator('#signin-form button[type=submit]').click();pg.locator('#dash-tab-seo').click()
 pg.locator('#seo-url').fill('file:///etc/passwd');pg.locator('#seo-submit').click();expect(pg.locator('#seo-status')).to_contain_text('Only web pages')
 pg.locator('#seo-url').fill('example.com');pg.locator('#seo-submit').click();expect(pg.locator('#seo-results')).to_be_visible()
 assert pg.locator('#seo-checks img').count()==0;expect(pg.locator('#seo-checks')).to_contain_text('<img src=x')
 with pg.expect_download() as dl:pg.locator('#seo-download').click()
 assert dl.value.suggested_filename.endswith('.json')
 assert not pg.evaluate('document.documentElement.scrollWidth > innerWidth')
 mode='error';pg.locator('#seo-rerun').click();expect(pg.locator('#seo-status')).to_contain_text('blocks automated checks')
 mode='hold';pg.locator('#seo-submit').click();expect(pg.locator('#seo-cancel')).to_be_visible();pg.locator('#seo-cancel').click();expect(pg.locator('#seo-status')).to_contain_text('cancelled')
 pg.locator('#seo-submit').click();expect(pg.locator('#seo-cancel')).to_be_visible();pg.locator('#header-logout').click();expect(pg.locator('[data-view="signin"]')).to_be_visible()
 expect(pg.locator('#seo-results')).to_be_hidden();expect(pg.locator('#seo-checks')).to_have_text('');assert pg.locator('#seo-url').input_value()==''
 assert not errors,errors
 for route in held:
  try: route.abort()
  except Exception: pass
 c.close();b.close()
print('PASS: URL validation, result rendering without HTML injection, download, mobile, server errors, cancel, logout cancels and clears scans.')
