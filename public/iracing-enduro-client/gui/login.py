import tkinter as tk
from tkinter import messagebox, ttk
import threading
import api_client
from config import save_config, load_config, DEFAULT_SERVER_URL


class LoginWindow:
    def __init__(self, on_success):
        self.on_success = on_success
        self.root = tk.Tk()
        self._build_ui()

    def _build_ui(self):
        self.root.title("iRacing Enduro Monitor — Login")
        self.root.geometry("360x330")
        self.root.resizable(False, False)
        self.root.configure(bg="#1a1a2e")

        # Center window
        self.root.update_idletasks()
        w = self.root.winfo_width()
        h = self.root.winfo_height()
        x = (self.root.winfo_screenwidth() // 2) - (w // 2)
        y = (self.root.winfo_screenheight() // 2) - (h // 2)
        self.root.geometry(f"+{x}+{y}")

        # Header
        header = tk.Frame(self.root, bg="#0f3460", pady=16)
        header.pack(fill="x")
        tk.Label(
            header,
            text="🏁  iRacing Enduro Monitor",
            font=("Segoe UI", 14, "bold"),
            fg="#e94560",
            bg="#0f3460",
        ).pack()
        tk.Label(
            header,
            text="Sign in to start tracking",
            font=("Segoe UI", 9),
            fg="#aaaacc",
            bg="#0f3460",
        ).pack()

        # Form
        form = tk.Frame(self.root, bg="#1a1a2e", padx=30, pady=20)
        form.pack(fill="both", expand=True)

        tk.Label(form, text="Server URL", font=("Segoe UI", 9), fg="#888899", bg="#1a1a2e").pack(anchor="w")
        cfg = load_config()
        self.server_var = tk.StringVar(value=cfg.get("server_url", DEFAULT_SERVER_URL))
        tk.Entry(
            form,
            textvariable=self.server_var,
            font=("Segoe UI", 10),
            bg="#16213e",
            fg="#aaaacc",
            insertbackground="white",
            relief="flat",
            bd=5,
        ).pack(fill="x", pady=(2, 12))

        tk.Label(form, text="Username", font=("Segoe UI", 9), fg="#ccccdd", bg="#1a1a2e").pack(anchor="w")
        self.username_var = tk.StringVar()
        tk.Entry(
            form,
            textvariable=self.username_var,
            font=("Segoe UI", 11),
            bg="#16213e",
            fg="white",
            insertbackground="white",
            relief="flat",
            bd=5,
        ).pack(fill="x", pady=(2, 12))

        tk.Label(form, text="Password", font=("Segoe UI", 9), fg="#ccccdd", bg="#1a1a2e").pack(anchor="w")
        self.password_var = tk.StringVar()
        tk.Entry(
            form,
            textvariable=self.password_var,
            show="•",
            font=("Segoe UI", 11),
            bg="#16213e",
            fg="white",
            insertbackground="white",
            relief="flat",
            bd=5,
        ).pack(fill="x", pady=(2, 16))

        self.status_label = tk.Label(
            form, text="", font=("Segoe UI", 9), fg="#e94560", bg="#1a1a2e"
        )
        self.status_label.pack()

        self.login_btn = tk.Button(
            form,
            text="Sign In",
            font=("Segoe UI", 11, "bold"),
            bg="#e94560",
            fg="white",
            activebackground="#c73652",
            activeforeground="white",
            relief="flat",
            cursor="hand2",
            command=self._on_login,
        )
        self.login_btn.pack(fill="x", pady=(4, 0))

        # Enter key triggers login
        self.root.bind("<Return>", lambda e: self._on_login())

    def _on_login(self):
        username = self.username_var.get().strip()
        password = self.password_var.get().strip()
        server_url = self.server_var.get().strip().rstrip("/") or DEFAULT_SERVER_URL

        if not username or not password:
            self.status_label.config(text="Please enter username and password")
            return

        self.login_btn.config(state="disabled", text="Signing in...")
        self.status_label.config(text="", fg="#e94560")

        def do_login():
            try:
                result = api_client.login(username, password, server_url=server_url)
                token = result["token"]
                user = result["user"]
                save_config({
                    "token": token,
                    "username": user["username"],
                    "user_id": user["id"],
                    "server_url": server_url,
                })
                self.root.after(0, lambda: self._login_success(user["username"]))
            except Exception as e:
                msg = "Invalid username or password"
                if "connect" in str(e).lower() or "timeout" in str(e).lower():
                    msg = f"Cannot reach {server_url} — check the URL and your connection"
                self.root.after(0, lambda: self._login_failed(msg))

        threading.Thread(target=do_login, daemon=True).start()

    def _login_success(self, username):
        self.root.destroy()
        self.on_success(username)

    def _login_failed(self, msg):
        self.status_label.config(text=msg)
        self.login_btn.config(state="normal", text="Sign In")

    def run(self):
        self.root.mainloop()


def show_login_if_needed(on_ready, _root=None):
    """Check stored token; show login window only if needed.
    _root: optional Tk root for thread-safe on_ready dispatch via after().
    """
    cfg = load_config()
    token = cfg.get("token")

    if token:
        def check():
            if api_client.validate_token():
                username = cfg.get("username", "Driver")
                if _root:
                    _root.after(0, lambda: on_ready(username))
                else:
                    on_ready(username)
            else:
                _show_login(on_ready)

        threading.Thread(target=check, daemon=True).start()
    else:
        _show_login(on_ready)


def _show_login(on_ready):
    win = LoginWindow(on_ready)
    win.run()
