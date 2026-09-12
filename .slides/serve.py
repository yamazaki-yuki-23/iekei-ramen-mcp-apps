import http.server, functools
class H(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
                      '.html': 'text/html; charset=utf-8'}
http.server.test(HandlerClass=H, port=8765, bind='127.0.0.1')
