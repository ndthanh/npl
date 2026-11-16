import email.message,hashlib,io,pathlib,sys,unittest,urllib.error
from types import SimpleNamespace
from unittest.mock import patch
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]/'bridge'))
import web_reader as reader

class ReaderTests(unittest.TestCase):
    def response(self,text,mime='text/html; charset=utf-8'):
        response=io.BytesIO(text.encode('utf-8'));response.headers=email.message.Message();response.headers['Content-Type']=mime;response.geturl=lambda:'https://example.com/docs/page';return response
    def fetch(self,text,mime='text/html; charset=utf-8'):
        response=self.response(text,mime)
        with patch('web_reader.bounded_addresses',return_value={'93.184.216.34'}),patch('web_reader.urllib.request.build_opener',return_value=SimpleNamespace(open=lambda *a,**k:response)):
            return reader.fetch_markdown('https://example.com/docs/page')
    def test_html_becomes_markdown_with_source_receipt_unicode_and_absolute_links(self):
        value=self.fetch('<title>Kiểm thử</title><nav>discard navigation</nav><main><h1>Thông tin dự án</h1><p>Nội dung tiếng Việt đủ dài để kiểm thử context.</p><a href="../guide">Hướng dẫn</a><img src="logo.png" alt="Biểu tượng"/><script>do_not_execute()</script></main>')
        text=value['markdown'];self.assertIn('Thông tin dự án',text);self.assertIn('https://example.com/guide',text);self.assertIn('Biểu tượng',text)
        self.assertNotIn('discard navigation',text);self.assertNotIn('do_not_execute',text)
        self.assertIn(value['receipt'],text);self.assertIn(value['finalUrl'],text)
        self.assertEqual(value['sha256'],hashlib.sha256(text.encode()).hexdigest())
    def test_large_plain_text_is_complete_and_not_silently_truncated(self):
        body='Dữ liệu context đầy đủ.\n'*9000;value=self.fetch(body,'text/plain; charset=utf-8')
        self.assertIn(body.strip(),value['markdown']);self.assertGreater(value['bytes'],12000)
    def test_unreadable_mime_empty_page_and_bot_wall_are_explicit_failures(self):
        for text,mime in [('binary','application/zip'),('<body>tiny</body>','text/html'),('<title>Just a moment</title><body>Checking your browser, enable javascript.</body>','text/html')]:
            with self.assertRaises(reader.URLContextError):self.fetch(text,mime)
    def test_private_destinations_and_redirects_are_rejected(self):
        with patch('web_reader.bounded_addresses',return_value={'127.0.0.1'}):
            with self.assertRaises(reader.URLContextError):reader.public_url('https://example.com/')
            with self.assertRaises(reader.URLContextError):reader.Redirects().redirect_request(None,None,302,'',{},'http://localhost/')
        for url in ['file:///tmp/test','https://user:password@example.com','https://example.com:8080/']:
            with self.assertRaises(reader.URLContextError):reader.public_url(url)

if __name__=='__main__':unittest.main()
