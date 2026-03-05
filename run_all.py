"""
Master launcher — starts all 4 services:
  1. FastAPI backend        → port 8000
  2. Client Chatbot         → port 8501
  3. Client Admin Panel     → port 8502
  4. Seller Admin Panel     → port 8503
"""

import subprocess
import sys
import time

def main():
    print("=" * 60)
    print("  🚀  Starting Multi-Tenant Chatbot Platform")
    print("=" * 60)

    processes = []

    # 1. FastAPI Backend
    print("\n[1/4] Starting FastAPI backend on http://127.0.0.1:8000 ...")
    backend = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "backend.main:app",
         "--host", "127.0.0.1", "--port", "8000", "--reload"],
    )
    processes.append(backend)
    time.sleep(2)

    # 2. Client Chatbot (Streamlit)
    print("[2/4] Starting Client Chatbot on http://127.0.0.1:8501 ...")
    client = subprocess.Popen(
        [sys.executable, "-m", "streamlit", "run", "client_app/app.py",
         "--server.port", "8501", "--server.headless", "true"],
    )
    processes.append(client)

    # 3. Client Admin Panel (Streamlit)
    print("[3/4] Starting Client Admin Panel on http://127.0.0.1:8502 ...")
    client_admin = subprocess.Popen(
        [sys.executable, "-m", "streamlit", "run", "client_admin/app.py",
         "--server.port", "8502", "--server.headless", "true"],
    )
    processes.append(client_admin)

    # 4. Seller Admin Panel (Streamlit)
    print("[4/4] Starting Seller Admin Panel on http://127.0.0.1:8503 ...")
    seller_admin = subprocess.Popen(
        [sys.executable, "-m", "streamlit", "run", "admin_app/app.py",
         "--server.port", "8503", "--server.headless", "true"],
    )
    processes.append(seller_admin)

    print("\n" + "=" * 60)
    print("  ✅  All services started!")
    print("  💬  Client Chatbot     : http://127.0.0.1:8501")
    print("  📊  Client Admin Panel : http://127.0.0.1:8502")
    print("  ⚙️   Seller Admin Panel : http://127.0.0.1:8503")
    print("  🔧  Backend API        : http://127.0.0.1:8000/docs")
    print("=" * 60)
    print("\nPress Ctrl+C to stop all services.\n")

    try:
        for p in processes:
            p.wait()
    except KeyboardInterrupt:
        print("\n⏹️  Shutting down all services...")
        for p in processes:
            p.terminate()
        print("Done.")

if __name__ == "__main__":
    main()
