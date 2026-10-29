"""Fetch public HTML as Markdown context, using no browser or search API."""
from __future__ import annotations
import datetime
import hashlib
import ipaddress
import json
import pathlib
import re
import secrets
import socket
import queue
import threading
import ssl
import truststore
import urllib.error
import urllib.parse
import urllib.request
from bs4 import BeautifulSoup
from markdownify import markdownify

class URLContextError(ValueError):pass

def bounded_addresses(host,port):
    result=queue.Queue(maxsize=1)
    def resolve():
        try:result.put(socket.getaddrinfo(host,port,type=socket.SOCK_STREAM))
        except Exception as error:result.put(error)
    threading.Thread(target=resolve,daemon=True).start()
    try:value=result.get(timeout=5)
    except queue.Empty:raise URLContextError('DNS lookup timed out after 5 seconds')
    if isinstance(value,Exception):raise value
    return {item[4][0] for item in value}

def public_url(url):
    if not isinstance(url,str) or len(url)>4096:raise URLContextError('Invalid URL length')
    parsed=urllib.parse.urlsplit(url)
    if parsed.scheme not in ('http','https') or not parsed.hostname or parsed.username or parsed.password:
        raise URLContextError('Use a public HTTP(S) URL without embedded credentials')
    if parsed.port not in (None,80,443):raise URLContextError('Only HTTP/HTTPS default ports are supported')
    try:addresses=bounded_addresses(parsed.hostname,parsed.port or (443 if parsed.scheme=='https' else 80))
    except OSError as error:raise URLContextError('Cannot resolve URL host: '+str(error)) from error
    if not addresses or any(not ipaddress.ip_address(value).is_global for value in addresses):
        raise URLContextError('Private, loopback, link-local and reserved network destinations are not supported')
    return urllib.parse.urlunsplit((parsed.scheme,parsed.netloc,parsed.path or '/',parsed.query,''))

class Redirects(urllib.request.HTTPRedirectHandler):
    max_redirections=5
    def redirect_request(self,request,fp,code,message,headers,newurl):
        return super().redirect_request(request,fp,code,message,headers,public_url(newurl))

def fetch_markdown(url,*,timeout=20,max_html_bytes=2*1024*1024):
    url=public_url(url)
    # Use the OS certificate trust store, matching enterprise browser trust.
    # Certificate verification remains enabled.
    opener=urllib.request.build_opener(Redirects(),urllib.request.HTTPSHandler(context=truststore.SSLContext(ssl.PROTOCOL_TLS_CLIENT)))
    request=urllib.request.Request(url,headers={'User-Agent':'nopilot/0.1 (local HTML context reader)','Accept':'text/html,application/xhtml+xml,text/plain,text/markdown','Accept-Encoding':'identity'})
    try:
        with opener.open(request,timeout=timeout) as response:
            final_url=public_url(response.geturl());mime=response.headers.get_content_type()
            if mime not in ('text/html','application/xhtml+xml','text/plain','text/markdown'):
                raise URLContextError('URL is not readable HTML/text: '+mime)
            raw=response.read(max_html_bytes+1)
            if len(raw)>max_html_bytes:raise URLContextError('HTML response exceeds 2 MiB; no truncated page was sent')
            encoding=response.headers.get_content_charset()
    except urllib.error.HTTPError as error:
        raise URLContextError(f'Website returned HTTP {error.code}; no attempt was made to bypass login or bot verification') from error
    except urllib.error.URLError as error:raise URLContextError('Cannot fetch URL: '+str(error.reason)) from error
    if mime in ('text/plain','text/markdown'):
        text=raw.decode(encoding or 'utf-8',errors='replace');title=urllib.parse.urlsplit(final_url).hostname
    else:
        soup=BeautifulSoup(raw,'html.parser',from_encoding=encoding)
        title=soup.title.get_text(' ',strip=True) if soup.title else urllib.parse.urlsplit(final_url).hostname
        for node in soup.select('script,style,noscript,nav,header,footer,aside,form,iframe,svg,canvas'):
            node.decompose()
        candidates=soup.select('main,article,[role="main"]')
        main=max(candidates,key=lambda n:len(n.get_text(' ',strip=True))) if candidates else (soup.body or soup)
        plain=main.get_text(' ',strip=True)
        if re.search(r'just a moment|verify (you are|that you are) human|access denied|captcha',title or '',re.I) or (len(plain)<1600 and re.search(r'captcha|enable javascript|verify you are human|checking your browser',plain,re.I)):
            raise URLContextError('The page requires JavaScript, login or human verification; use the browser.open tool')
        for link in main.select('a[href]'):
            absolute=urllib.parse.urljoin(final_url,link['href'])
            if urllib.parse.urlsplit(absolute).scheme in ('http','https'):link['href']=absolute
            else:link.attrs.pop('href',None)
        for image in main.select('img'):
            image.replace_with(image.get('alt',''))
        text=markdownify(str(main),heading_style='ATX',bullets='-',strip=['button','input']).strip()
    text=re.sub(r'\n{4,}','\n\n\n',text).strip()
    if len(text)<40:raise URLContextError('Too little readable server-rendered content; this may be a JavaScript-only page')
    receipt=secrets.token_hex(12);fetched=datetime.datetime.now(datetime.timezone.utc).isoformat()
    document=f'# {title}\n\nSource URL: {final_url}\nFetched UTC: {fetched}\nContext receipt: {receipt}\n\n---\n\n{text}\n'
    data=document.encode('utf-8')
    if len(data)>1024*1024:raise URLContextError('Converted Markdown exceeds the current 1 MiB attachment limit')
    return {'url':url,'finalUrl':final_url,'title':title,'fetchedAt':fetched,'receipt':receipt,
            'markdown':document,'characters':len(document),'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest(),
            'reader':'urllib + BeautifulSoup + markdownify; no JavaScript execution'}
