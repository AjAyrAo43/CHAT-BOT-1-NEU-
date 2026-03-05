import sys
import os
import traceback

# Force the current directory to be the first place Python looks for modules
sys.path.insert(0, os.path.abspath(os.getcwd()))

try:
    from backend.main import app
    import uvicorn

    if __name__ == "__main__":
        print("Starting backend on http://127.0.0.1:8000 ...")
        print("  💬  Client Chatbot     : streamlit run client_app/app.py --server.port 8501")
        print("  📊  Client Admin Panel : streamlit run client_admin/app.py --server.port 8502")
        print("  ⚙️   Seller Admin Panel : streamlit run admin_app/app.py --server.port 8503")
        print("  🚀  Or run 'python run_all.py' to start everything at once.")
        uvicorn.run("backend.main:app", host="127.0.0.1", port=8000, reload=True)
except Exception as e:
    print(f"Error starting backend: {e}")
    print("\nFull traceback:")
    traceback.print_exc()
