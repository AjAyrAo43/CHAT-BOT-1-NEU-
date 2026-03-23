import sys
import os
import traceback
import threading
import http.server

# Force the current directory to be the first place Python looks for modules
sys.path.insert(0, os.path.abspath(os.getcwd()))

FRONTEND_DIR = os.path.join(os.path.abspath(os.getcwd()), "frontend")
FRONTEND_PORT = 8080


class QuietFrontendHandler(http.server.SimpleHTTPRequestHandler):
    """Serve the frontend/ directory silently (no access logs)."""
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=FRONTEND_DIR, **kwargs)

    def log_message(self, format, *args):
        pass  # Suppress request logs


def start_frontend_server():
    server = http.server.HTTPServer(("127.0.0.1", FRONTEND_PORT), QuietFrontendHandler)
    print(f"[Frontend] Serving on http://127.0.0.1:{FRONTEND_PORT}")
    print(f"  Admin Panel  : http://127.0.0.1:{FRONTEND_PORT}/admin/")
    print(f"  Client Panel : http://127.0.0.1:{FRONTEND_PORT}/client/")
    print(f"  Chatbot      : http://127.0.0.1:{FRONTEND_PORT}/chatbot/")
    server.serve_forever()


try:
    import uvicorn

    if __name__ == "__main__":
        # Start the lightweight static-file frontend server in a background thread
        t = threading.Thread(target=start_frontend_server, daemon=True)
        t.start()

        print("\n[Backend] Starting FastAPI backend on http://127.0.0.1:8000 ...")
        uvicorn.run("backend.main:app", host="127.0.0.1", port=8000, reload=False)
except Exception as e:
    print(f"Error starting server: {e}")
    print("\nFull traceback:")
    traceback.print_exc()
