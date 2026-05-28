from tkinter import *
from tkinter import ttk, messagebox
import os
import webbrowser

from database import (
    APP_MODULES,
    authenticate_user,
    get_all_project_choices,
    get_all_users,
    get_user_permissions,
    get_user_project_ids,
    init_db,
    save_user,
    save_user_permissions,
    save_user_projects,
)
from utils import normalize_buttons, keep_window_active, apply_page_watermark


BASE_DIR = os.path.dirname(os.path.abspath(__file__))
LOGIN_BACKGROUND = os.path.join(BASE_DIR, "Steel Plant.png.png")
LOGOUT_ICON = os.path.join(BASE_DIR, "logout_icon.png")
WEB_DAILY_PROGRESS_URL = "http://127.0.0.1:5173"


class LoginWindow(Tk):
    def __init__(self):
        super().__init__()
        init_db()
        self.title("Login - Rourkela Steel Plant Project Department")
        self.geometry("1520x920")
        self.state("zoomed")

        self.bg_image = None
        self.bg_image_loaded = False
        self.canvas = Canvas(self, highlightthickness=0)
        self.canvas.pack(fill=BOTH, expand=True)
        self.canvas.bind("<Configure>", self.draw_background)

        self.admin_username_var = StringVar(value="admin")
        self.admin_password_var = StringVar()
        self.user_username_var = StringVar()
        self.user_password_var = StringVar()
        self.build_login_card()
        apply_page_watermark(self)

    def draw_background(self, event=None):
        self.canvas.delete("all")
        if not self.bg_image_loaded and os.path.exists(LOGIN_BACKGROUND):
            self.bg_image_loaded = True
            try:
                self.bg_image = PhotoImage(file=LOGIN_BACKGROUND)
            except Exception:
                self.bg_image = None

        if self.bg_image:
            self.canvas.create_image(0, 0, image=self.bg_image, anchor=NW)
        else:
            if os.path.exists(LOGIN_BACKGROUND):
                self.canvas.configure(bg="#0f355e")
            else:
                self.canvas.configure(bg="#0f355e")

        self.canvas.create_rectangle(
            0,
            0,
            self.winfo_width(),
            self.winfo_height(),
            fill="#001f3f",
            stipple="gray50",
            outline="",
        )
        self.canvas.create_window(
            self.winfo_width() // 2,
            self.winfo_height() // 2,
            window=self.login_card,
        )

    def build_login_card(self):
        self.login_card = Frame(self.canvas, bg="white", bd=2, relief="ridge")
        Label(
            self.login_card,
            text="Rourkela Steel Plant",
            bg="white",
            fg="#003087",
            font=("Arial", 24, "bold"),
        ).pack(pady=(28, 4), padx=70)
        Label(
            self.login_card,
            text="Project Department Login",
            bg="white",
            fg="#333",
            font=("Arial", 14, "bold"),
        ).pack(pady=(0, 16))

        tabs = ttk.Notebook(self.login_card)
        tabs.pack(padx=45, pady=5, fill=X)

        admin_tab = Frame(tabs, bg="white")
        user_tab = Frame(tabs, bg="white")
        tabs.add(admin_tab, text="Admin Login")
        tabs.add(user_tab, text="User Login")

        self.build_login_tab(
            admin_tab,
            self.admin_username_var,
            self.admin_password_var,
            "admin",
            "Admin Login",
            "Default admin: admin / admin123",
        )
        self.build_login_tab(
            user_tab,
            self.user_username_var,
            self.user_password_var,
            "user",
            "User Login",
            "Use username/password created by Admin.",
        )

        self.login_tabs = tabs
        normalize_buttons(self.login_card)
        self.bind("<Return>", lambda event: self.login_from_selected_tab())

    def build_login_tab(self, parent, username_var, password_var, expected_role, button_text, note_text):
        form = Frame(parent, bg="white")
        form.pack(padx=22, pady=18, fill=X)

        Label(form, text="Username", bg="white", font=("Arial", 11, "bold")).pack(anchor=W)
        Entry(form, textvariable=username_var, width=34, font=("Arial", 12)).pack(pady=(4, 14), ipady=4)

        Label(form, text="Password", bg="white", font=("Arial", 11, "bold")).pack(anchor=W)
        Entry(form, textvariable=password_var, show="*", width=34, font=("Arial", 12)).pack(pady=(4, 18), ipady=4)

        Button(
            form,
            text=button_text,
            command=lambda: self.login(username_var, password_var, expected_role),
            bg="#003087",
            fg="white",
            font=("Arial", 12, "bold"),
            width=22,
            height=2,
        ).pack(pady=(0, 12))
        Label(form, text=note_text, bg="white", fg="#777", font=("Arial", 9)).pack(pady=(0, 8))

    def login_from_selected_tab(self):
        selected = self.login_tabs.index(self.login_tabs.select())
        if selected == 0:
            self.login(self.admin_username_var, self.admin_password_var, "admin")
        else:
            self.login(self.user_username_var, self.user_password_var, "user")

    def login(self, username_var, password_var, expected_role):
        user = authenticate_user(username_var.get(), password_var.get())
        if not user:
            messagebox.showerror("Login Failed", "Invalid username/password or inactive user.")
            return
        user_role = str(user.get("role") or "").strip().lower()
        expected_role = str(expected_role or "").strip().lower()
        if user_role != expected_role:
            messagebox.showerror(
                "Login Failed",
                f"Please use the {'Admin' if user_role == 'admin' else 'User'} Login tab for this account.",
            )
            return
        user["role"] = user_role

        self.destroy()
        app = MainApp(user)
        app.mainloop()


class HomeFrame(Frame):
    def __init__(self, parent, main_app=None):
        super().__init__(parent, bg="#f0f4f8")
        self.main_app = main_app

        content = Frame(self, bg="#f0f4f8")
        content.pack(expand=True)

        Label(
            content,
            text="Project Monitoring System",
            bg="#f0f4f8",
            fg="#003087",
            font=("Arial", 22, "bold"),
        ).pack(pady=(0, 10))
        Label(
            content,
            text="Use the left menu to open Dashboard, Capex, Projects, Reports, or Admin Panel.",
            bg="#f0f4f8",
            fg="#334155",
            font=("Arial", 12, "bold"),
        ).pack()
        apply_page_watermark(self)


class RepositoryFrame(Frame):
    def __init__(self, parent, main_app=None):
        super().__init__(parent, bg="#f0f4f8")
        self.main_app = main_app

        content = Frame(self, bg="#f0f4f8")
        content.pack(expand=True)

        Label(
            content,
            text="Repository",
            bg="#f0f4f8",
            fg="#003087",
            font=("Arial", 20, "bold"),
        ).pack(pady=(0, 10))
        Label(
            content,
            text="Repository module will be added here. Existing project-wise Repository access is unchanged.",
            bg="#f0f4f8",
            fg="#334155",
            font=("Arial", 12, "bold"),
        ).pack(pady=(0, 16))
        Button(
            content,
            text="Open Repository",
            command=self.open_repository,
            bg="#555555",
            fg="white",
            font=("Arial", 11, "bold"),
            width=18,
            height=2,
            state=NORMAL if (not self.main_app or self.main_app.can_access("repository")) else DISABLED,
        ).pack()
        apply_page_watermark(self)

    def open_repository(self):
        if self.main_app and hasattr(self.main_app, "show_repository"):
            self.main_app.show_repository()


class ProjectsModuleFrame(Frame):
    def __init__(self, parent, main_app=None):
        super().__init__(parent, bg="#f0f4f8")
        self.main_app = main_app
        self.current_section = None
        self.section_buttons = {}
        self.section_order = ("project_details", "ongoing", "schedule", "repository")

        header = Frame(self, bg="#f0f4f8")
        header.pack(fill=X, padx=18, pady=(14, 8))
        Label(
            header,
            text="Projects",
            bg="#f0f4f8",
            fg="#003087",
            font=("Arial", 18, "bold"),
        ).pack(anchor="w")

        self.content = Frame(self, bg="#f0f4f8")
        self.content.pack(fill=BOTH, expand=True, padx=10, pady=(0, 10))

        self.sections = {}
        self.section_factories = {
            "project_details": self.create_project_details_section,
            "ongoing": self.create_ongoing_section,
            "schedule": self.create_schedule_section,
            "repository": self.create_repository_section,
        }

        self.placeholder = Label(
            self.content,
            text="Select a Projects option from the left menu.",
            bg="#f0f4f8",
            fg="#334155",
            font=("Arial", 16, "bold"),
        )
        self.placeholder.pack(expand=True)

        apply_page_watermark(self)
        normalize_buttons(self)

    def create_project_details_section(self):
        from project_details import ProjectDetailsFrame

        return ProjectDetailsFrame(self.content, main_app=self.main_app)

    def create_ongoing_section(self):
        from ongoing_projects import OngoingProjectsFrame

        return OngoingProjectsFrame(self.content, main_app=self.main_app)

    def create_schedule_section(self):
        from schedule import ScheduleFrame

        return ScheduleFrame(self.content, main_app=self.main_app)

    def create_repository_section(self):
        return RepositoryFrame(self.content, main_app=self.main_app)

    def get_section_frame(self, key):
        if key not in self.sections:
            factory = self.section_factories.get(key)
            if not factory:
                return None
            if self.placeholder.winfo_ismapped():
                self.placeholder.pack_forget()
            self.sections[key] = factory()
            normalize_buttons(self.sections[key])
        return self.sections[key]

    def can_access_section(self, key):
        return not self.main_app or self.main_app.can_access(key)

    def show_section(self, key):
        if key not in self.section_factories:
            return
        if not self.can_access_section(key):
            messagebox.showwarning("Access Denied", "You do not have access to this section.")
            return

        for frame in self.sections.values():
            frame.pack_forget()

        frame = self.get_section_frame(key)
        if not frame:
            return
        if hasattr(frame, "load_list"):
            frame.load_list()
        if hasattr(frame, "refresh_current_tab"):
            frame.refresh_current_tab()
        if hasattr(frame, "refresh_all"):
            frame.refresh_all()
        frame.pack(fill=BOTH, expand=True)

        for name, button in self.section_buttons.items():
            if str(button.cget("state")) == DISABLED:
                continue
            if name == key:
                button.config(bg="#0f766e", fg="white")
            else:
                button.config(bg="#dbeafe", fg="#003087")

        self.current_section = key

    def refresh_all(self):
        if self.current_section and self.current_section in self.sections:
            frame = self.sections[self.current_section]
            if hasattr(frame, "load_list"):
                frame.load_list()
            if hasattr(frame, "refresh_current_tab"):
                frame.refresh_current_tab()
            if hasattr(frame, "refresh_all"):
                frame.refresh_all()


class MainApp(Tk):
    def __init__(self, current_user):
        super().__init__()
        self.current_user = current_user
        self.permissions = get_user_permissions(current_user["id"])
        self.allowed_project_ids = get_user_project_ids(current_user["id"])

        self.title("Rourkela Steel Plant Project Department")
        self.geometry("1520x920")
        self.state("zoomed")
        self.logout_icon = None
        if os.path.exists(LOGOUT_ICON):
            self.logout_icon = PhotoImage(file=LOGOUT_ICON).subsample(2, 2)

        top_frame = Frame(self, bg="#003087", height=80)
        top_frame.pack(fill=X)
        top_frame.pack_propagate(False)
        top_frame.grid_columnconfigure(0, weight=1)
        top_frame.grid_columnconfigure(1, weight=1)
        top_frame.grid_columnconfigure(2, weight=1)
        top_frame.grid_rowconfigure(0, weight=1)
        top_frame.grid_rowconfigure(1, weight=1)

        title_label = Label(
            top_frame,
            text="Rourkela Steel Plant Project Department",
            bg="#003087",
            fg="white",
            font=("Arial", 22, "bold"),
        )
        title_label.grid(row=0, column=1, pady=(12, 0), sticky="n")
        self.login_label = Label(
            top_frame,
            text=f"Logged in: {current_user['username']} ({current_user['role']})",
            bg="#003087",
            fg="#dbeafe",
            font=("Arial", 10, "bold"),
        )
        self.login_label.grid(row=1, column=2, padx=(0, 22), pady=(0, 8), sticky="e")

        sidebar = Frame(self, bg="#f0f0f0", width=280, relief="raised", bd=2)
        self.sidebar = sidebar
        self.sidebar_visible = True
        self.registration_menu_auto_hide = False
        sidebar.pack(side=LEFT, fill=Y)
        sidebar.pack_propagate(False)

        Label(sidebar, text="\u2630 Menu", bg="#f0f0f0", font=("Arial", 14, "bold")).pack(pady=20)

        menu_area = Frame(sidebar, bg="#f0f0f0")
        menu_area.pack(fill=BOTH, expand=True, padx=10, pady=(0, 10))

        menu_canvas = Canvas(menu_area, bg="#f0f0f0", highlightthickness=0, bd=0)
        menu_scroll = ttk.Scrollbar(menu_area, orient=VERTICAL, command=menu_canvas.yview)
        menu_scroll.pack(side=RIGHT, fill=Y)
        menu_canvas.pack(side=LEFT, fill=BOTH, expand=True)
        menu_canvas.configure(yscrollcommand=menu_scroll.set)

        menu_frame = Frame(menu_canvas, bg="#f0f0f0")
        menu_window = menu_canvas.create_window((0, 0), window=menu_frame, anchor="nw")

        def update_menu_scroll(event=None):
            menu_canvas.configure(scrollregion=menu_canvas.bbox("all"))

        def resize_menu_frame(event):
            menu_canvas.itemconfigure(menu_window, width=event.width)

        menu_frame.bind("<Configure>", update_menu_scroll)
        menu_canvas.bind("<Configure>", resize_menu_frame)

        self.menu_buttons = {}
        self.project_sub_buttons = {}
        self.project_submenu_frame = None
        self.add_menu_button(menu_frame, "registration", "Project Registration", self.show_registration_from_admin)
        self.add_menu_button(menu_frame, "dashboard", "Dashboard", self.show_dashboard)
        self.add_menu_button(menu_frame, "local_ai", "AI Assistant", self.show_local_ai_assistant)
        self.add_menu_button(menu_frame, "capex", "Capex", self.show_capex)
        self.add_menu_button(menu_frame, "projects", "Projects", self.show_projects_module)
        self.build_project_submenu(menu_frame)
        self.add_menu_button(menu_frame, "reports", "Reports", self.show_reports)

        if self.is_admin():
            Button(
                menu_frame,
                text="Admin Panel",
                command=self.open_admin_panel,
                bg="#f59e0b",
                fg="black",
                font=("Arial", 11, "bold"),
                height=2,
                width=32,
                anchor="w",
            ).pack(pady=12, padx=15)

        if self.logout_icon:
            Button(
                sidebar,
                image=self.logout_icon,
                command=self.logout,
                bg="#c8102e",
                activebackground="#c8102e",
                relief="raised",
                bd=2,
            ).pack(side=BOTTOM, pady=25, padx=15)
        else:
            Button(
                sidebar,
                text="\U0001F6AA",
                command=self.logout,
                bg="#c8102e",
                fg="white",
                font=("Arial", 11, "bold"),
                height=2,
                width=32,
            ).pack(side=BOTTOM, pady=25, padx=15)

        self.menu_hover_strip = Frame(self, bg="#d9dde5", width=12, cursor="hand2")
        self.menu_hover_strip.pack_propagate(False)
        self.menu_hover_strip.bind("<Enter>", self.expand_registration_menu)
        self.bind_sidebar_hover(sidebar)

        self.container = Frame(self)
        self.container.pack(side=LEFT, fill=BOTH, expand=True)

        self.frames = {}
        self.frame_factories = {
            "home": lambda: HomeFrame(self.container, main_app=self),
            "registration": self.create_registration_frame,
            "projects": lambda: ProjectsModuleFrame(self.container, main_app=self),
        }

        self.show_frame("projects" if self.can_access_main_module("projects") else "home")
        normalize_buttons(self)

    def bind_sidebar_hover(self, widget):
        widget.bind("<Enter>", self.expand_registration_menu, add="+")
        widget.bind("<Leave>", self.schedule_registration_menu_collapse, add="+")
        for child in widget.winfo_children():
            self.bind_sidebar_hover(child)

    def set_registration_menu_mode(self, enabled):
        self.registration_menu_auto_hide = bool(enabled)
        if enabled:
            self.login_label.config(text=str(self.current_user.get("username") or ""))
            self.login_label.grid_configure(row=1, column=2, padx=(0, 22), pady=(0, 8), sticky="e")
            self.collapse_registration_menu()
        else:
            self.login_label.config(text=f"Logged in: {self.current_user['username']} ({self.current_user['role']})")
            self.login_label.grid_configure(row=1, column=1, padx=0, pady=(0, 8), sticky="n")
            self.menu_hover_strip.pack_forget()
            if not self.sidebar_visible:
                self.sidebar.pack(side=LEFT, fill=Y, before=self.container)
                self.sidebar_visible = True

    def expand_registration_menu(self, event=None):
        if not self.registration_menu_auto_hide:
            return
        self.menu_hover_strip.pack_forget()
        if not self.sidebar_visible:
            self.sidebar.pack(side=LEFT, fill=Y, before=self.container)
            self.sidebar_visible = True

    def collapse_registration_menu(self, event=None):
        if not self.registration_menu_auto_hide:
            return
        if self.sidebar_visible:
            self.sidebar.pack_forget()
            self.sidebar_visible = False
        if not self.menu_hover_strip.winfo_ismapped():
            self.menu_hover_strip.pack(side=LEFT, fill=Y, before=self.container)

    def schedule_registration_menu_collapse(self, event=None):
        if not self.registration_menu_auto_hide:
            return

        def collapse_if_pointer_left():
            if not self.registration_menu_auto_hide or not self.sidebar_visible:
                return
            pointer_x = self.winfo_pointerx()
            pointer_y = self.winfo_pointery()
            left = self.sidebar.winfo_rootx()
            top = self.sidebar.winfo_rooty()
            right = left + self.sidebar.winfo_width()
            bottom = top + self.sidebar.winfo_height()
            if not (left <= pointer_x <= right and top <= pointer_y <= bottom):
                self.collapse_registration_menu()

        self.after(180, collapse_if_pointer_left)

    def create_registration_frame(self):
        from registration import RegistrationFrame

        return RegistrationFrame(self.container, main_app=self)

    def get_frame(self, name):
        if name not in self.frames:
            factory = self.frame_factories.get(name)
            if not factory:
                return None
            self.frames[name] = factory()
            normalize_buttons(self.frames[name])
        return self.frames[name]

    def add_menu_button(self, sidebar, module_key, text, command):
        state = NORMAL if self.can_access_main_module(module_key) else DISABLED
        btn = Button(
            sidebar,
            text=text,
            command=command,
            bg="#008000" if state == NORMAL else "#999999",
            fg="white",
            font=("Arial", 11, "bold"),
            height=2,
            width=32,
            anchor="w",
            state=state,
        )
        btn.pack(pady=6, padx=15)
        self.menu_buttons[module_key] = btn
        return btn

    def build_project_submenu(self, parent):
        self.project_submenu_frame = Frame(parent, bg="#f0f0f0")
        project_sections = (
            ("project_details", "Project Details"),
            ("ongoing", "Ongoing Projects"),
            ("schedule", "Schedule"),
            ("repository", "Repository"),
        )
        for section_key, label in project_sections:
            state = NORMAL if self.can_access(section_key) else DISABLED
            btn = Button(
                self.project_submenu_frame,
                text=label,
                command=lambda key=section_key: self.show_projects_module(key),
                bg="#dbeafe" if state == NORMAL else "#cccccc",
                fg="#003087" if state == NORMAL else "#555555",
                font=("Arial", 9, "bold"),
                height=1,
                width=28,
                anchor="w",
                padx=14,
                state=state,
            )
            btn.pack(fill=X, padx=(34, 15), pady=2)
            self.project_sub_buttons[section_key] = btn

    def set_project_submenu_visible(self, visible):
        if not self.project_submenu_frame:
            return
        if visible:
            if not self.project_submenu_frame.winfo_ismapped():
                self.project_submenu_frame.pack(
                    fill=X,
                    pady=(0, 6),
                    after=self.menu_buttons.get("projects"),
                )
            self.update_project_submenu_state()
        else:
            self.project_submenu_frame.pack_forget()

    def update_project_submenu_state(self, active_section=None):
        projects_frame = self.frames.get("projects") if hasattr(self, "frames") else None
        if active_section is None and projects_frame:
            active_section = getattr(projects_frame, "current_section", None)

        for section_key, btn in self.project_sub_buttons.items():
            if str(btn.cget("state")) == DISABLED:
                continue
            if section_key == active_section:
                btn.config(bg="#0f766e", fg="white")
            else:
                btn.config(bg="#dbeafe", fg="#003087")

    def is_admin(self):
        return self.current_user.get("role") == "admin"

    def can_access(self, module_key):
        return self.is_admin() or self.permissions.get(module_key, {}).get("access", False)

    def can_edit(self, module_key):
        return self.is_admin() or self.permissions.get(module_key, {}).get("edit", False)

    def can_access_main_module(self, module_key):
        if module_key == "projects":
            return (
                self.is_admin()
                or self.can_access("project_details")
                or self.can_access("ongoing")
                or self.can_access("schedule")
                or self.can_access("repository")
                or self.can_access("daily_progress")
            )
        return self.can_access(module_key)

    def get_allowed_project_ids(self):
        return None if self.is_admin() else self.allowed_project_ids

    def can_access_project(self, project_id):
        return self.is_admin() or int(project_id) in self.allowed_project_ids

    def show_frame(self, name):
        if name != "home" and not self.can_access_main_module(name):
            messagebox.showwarning("Access Denied", "You do not have access to this page.")
            return
        for frame in self.frames.values():
            frame.pack_forget()
        frame = self.get_frame(name)
        if not frame:
            return
        if hasattr(frame, "load_list"):
            frame.load_list()
        if hasattr(frame, "refresh_current_tab"):
            frame.refresh_current_tab()
        if hasattr(frame, "refresh_all"):
            frame.refresh_all()
        frame.pack(fill=BOTH, expand=True)
        self.set_project_submenu_visible(name == "projects")
        self.set_registration_menu_mode(name == "registration")

    def show_projects_module(self, section=None):
        self.show_frame("projects")
        projects_frame = self.frames.get("projects")
        if projects_frame and section:
            projects_frame.show_section(section)
        self.update_project_submenu_state(section)
        if section:
            self.set_project_submenu_visible(False)

    def show_registration_from_admin(self):
        self.show_frame("registration")

    def show_project_details(self):
        self.show_projects_module("project_details")

    def show_ongoing(self):
        self.show_projects_module("ongoing")

    def show_daily_progress_report(self):
        if not self.can_access("daily_progress"):
            messagebox.showwarning("Access Denied", "You do not have access to Daily Progress Report.")
            return
        webbrowser.open(WEB_DAILY_PROGRESS_URL)

    def show_capex(self):
        self.set_project_submenu_visible(False)
        if not self.can_access("capex"):
            messagebox.showwarning("Access Denied", "You do not have access to CAPEX.")
            return
        from capex import CapexWindow

        CapexWindow(self, main_app=self)

    def show_dashboard(self):
        self.set_project_submenu_visible(False)
        if self.can_access("dashboard"):
            from dashboard import DashboardWindow

            win = DashboardWindow(self, main_app=self)
            keep_window_active(win)

    def show_reports(self):
        self.set_project_submenu_visible(False)
        if self.can_access("reports"):
            messagebox.showinfo("Coming Soon", "Reports window will be added soon!")

    def show_local_ai_assistant(self):
        self.set_project_submenu_visible(False)
        if not self.can_access("local_ai"):
            messagebox.showwarning("Access Denied", "You do not have access to Local AI Assistant.")
            return
        from local_ai_assistant import LocalAIAssistant

        win = LocalAIAssistant(self, main_app=self)
        keep_window_active(win.win)

    def open_schedule_window(self, project_uid=None, project_name=None):
        if not self.can_access("schedule"):
            messagebox.showwarning("Access Denied", "You do not have access to Schedule.")
            return
        win = Toplevel(self)
        suffix = f" - {project_uid}" if project_uid else ""
        win.title(f"Schedule{suffix}")
        win.geometry("1680x960")
        from schedule import ScheduleFrame

        frame = ScheduleFrame(win, main_app=self)
        frame.pack(fill=BOTH, expand=True)
        keep_window_active(win)

    def show_schedule(self):
        self.open_schedule_window()

    def show_repository(self, project_id=None, uid=None, project_name=None):
        if self.can_access("repository"):
            messagebox.showinfo("Coming Soon", "Repository window will be added soon!")

    def open_admin_panel(self):
        self.set_project_submenu_visible(False)
        win = AdminPanelWindow(self)
        keep_window_active(win)

    def logout(self):
        self.destroy()
        LoginWindow().mainloop()


class AdminPanelWindow(Toplevel):
    def __init__(self, parent):
        super().__init__(parent)
        self.parent_app = parent
        self.title("Admin Panel - User Rights")
        self.geometry("1520x820")
        self.minsize(1180, 680)
        try:
            self.state("zoomed")
        except Exception:
            pass
        self.configure(bg="#f0f4f8")
        self.selected_user_id = None
        self.access_vars = {}
        self.edit_vars = {}
        self.project_vars = {}
        self.users = []
        self.projects = []
        self.build_ui()
        self.load_users()
        self.load_projects()
        apply_page_watermark(self)
        normalize_buttons(self)

    def build_ui(self):
        self.grid_columnconfigure(0, weight=1)
        self.grid_rowconfigure(2, weight=1)

        Label(
            self,
            text="Admin Panel - User Management & Rights",
            bg="#f0f4f8",
            fg="#003087",
            font=("Arial", 18, "bold"),
        ).grid(row=0, column=0, sticky="ew", pady=(24, 18))

        action_row = Frame(self, bg="#f0f4f8")
        action_row.grid(row=1, column=0, sticky="ew", padx=20, pady=(0, 26))
        action_row.grid_columnconfigure(0, weight=1)
        action_row.grid_columnconfigure(1, weight=1)
        Button(
            action_row,
            text="Open Project Registration",
            command=self.open_project_registration,
            bg="#0f766e",
            fg="white",
            font=("Arial", 10, "bold"),
            width=24,
        ).grid(row=0, column=0, sticky="w")
        Button(
            action_row,
            text="Close",
            command=self.destroy,
            bg="#555555",
            fg="white",
            font=("Arial", 10, "bold"),
            width=24,
        ).grid(row=0, column=1, sticky="e")

        body = Frame(self, bg="#f0f4f8")
        body.grid(row=2, column=0, sticky="nsew", padx=20, pady=(0, 0))
        body.grid_columnconfigure(0, minsize=280, weight=0)
        body.grid_columnconfigure(1, weight=1)
        body.grid_rowconfigure(0, weight=1)

        left = Frame(body, bg="#f0f4f8")
        left.grid(row=0, column=0, sticky="nsew", padx=(0, 24))
        left.grid_columnconfigure(0, weight=1)
        left.grid_rowconfigure(1, weight=1)
        Label(left, text="Users", bg="#f0f4f8", font=("Arial", 12, "bold")).grid(row=0, column=0, sticky="w")
        user_list_frame = Frame(left, bg="#f0f4f8")
        user_list_frame.grid(row=1, column=0, sticky="nsew", pady=(12, 0))
        user_list_frame.grid_columnconfigure(0, weight=1)
        user_list_frame.grid_rowconfigure(0, weight=1)
        self.user_list = Listbox(user_list_frame, width=34, height=24, borderwidth=1, relief=SOLID)
        self.user_list.grid(row=0, column=0, sticky="nsew")
        user_scroll = ttk.Scrollbar(user_list_frame, orient="vertical", command=self.user_list.yview)
        user_scroll.grid(row=0, column=1, sticky="ns")
        self.user_list.configure(yscrollcommand=user_scroll.set)
        self.user_list.bind("<<ListboxSelect>>", self.on_user_select)

        right = Frame(body, bg="#f0f4f8")
        right.grid(row=0, column=1, sticky="nsew")
        right.grid_columnconfigure(0, weight=1)
        right.grid_rowconfigure(1, weight=1)

        form = LabelFrame(right, text="User Details", bg="#f0f4f8", font=("Arial", 11, "bold"))
        form.grid(row=0, column=0, sticky="ew", pady=(0, 26))
        form.grid_columnconfigure(4, weight=1)
        self.username_var = StringVar()
        self.password_var = StringVar()
        self.role_var = StringVar(value="user")
        self.active_var = BooleanVar(value=True)

        Label(form, text="Username:", bg="#f0f4f8").grid(row=0, column=0, padx=(14, 10), pady=(14, 10), sticky=W)
        Entry(form, textvariable=self.username_var, width=26).grid(row=0, column=1, padx=(0, 24), pady=(14, 10), sticky=W)
        Label(form, text="Password:", bg="#f0f4f8").grid(row=0, column=2, padx=(0, 10), pady=(14, 10), sticky=W)
        Entry(form, textvariable=self.password_var, width=22, show="*").grid(row=0, column=3, padx=(0, 24), pady=(14, 10), sticky=W)
        Label(form, text="Role:", bg="#f0f4f8").grid(row=1, column=0, padx=(14, 10), pady=(10, 14), sticky=W)
        ttk.Combobox(form, textvariable=self.role_var, values=["user", "admin"], width=23, state="readonly").grid(
            row=1,
            column=1,
            padx=(0, 24),
            pady=(10, 14),
            sticky=W,
        )
        Checkbutton(form, text="Active", variable=self.active_var, bg="#f0f4f8").grid(
            row=1,
            column=2,
            padx=(0, 10),
            pady=(10, 14),
            sticky=W,
        )

        rights_area = Frame(right, bg="#f0f4f8")
        rights_area.grid(row=1, column=0, sticky="nsew")
        rights_area.grid_columnconfigure(0, weight=46, uniform="rights")
        rights_area.grid_columnconfigure(1, weight=54, uniform="rights")
        rights_area.grid_rowconfigure(0, weight=1)

        rights = LabelFrame(rights_area, text="Page Rights", bg="#f0f4f8", font=("Arial", 11, "bold"))
        rights.grid(row=0, column=0, sticky="nsew", padx=(0, 12))
        rights.grid_columnconfigure(0, minsize=175, weight=1)
        rights.grid_columnconfigure(1, minsize=70, weight=0)
        rights.grid_columnconfigure(2, minsize=70, weight=0)
        Label(rights, text="Page", bg="#f0f4f8", font=("Arial", 10, "bold")).grid(row=0, column=0, padx=14, pady=(12, 10), sticky=W)
        Label(rights, text="Access", bg="#f0f4f8", font=("Arial", 10, "bold")).grid(row=0, column=1, padx=8, pady=(12, 10))
        Label(rights, text="Edit", bg="#f0f4f8", font=("Arial", 10, "bold")).grid(row=0, column=2, padx=8, pady=(12, 10))

        for idx, (module_key, label) in enumerate(APP_MODULES, start=1):
            self.access_vars[module_key] = BooleanVar(value=False)
            self.edit_vars[module_key] = BooleanVar(value=False)
            Label(rights, text=label, bg="#f0f4f8").grid(row=idx, column=0, padx=14, pady=7, sticky=W)
            Checkbutton(rights, variable=self.access_vars[module_key], bg="#f0f4f8").grid(row=idx, column=1, padx=8, pady=7)
            Checkbutton(rights, variable=self.edit_vars[module_key], bg="#f0f4f8").grid(row=idx, column=2, padx=8, pady=7)

        projects_box = LabelFrame(rights_area, text="Project Access", bg="#f0f4f8", font=("Arial", 11, "bold"))
        projects_box.grid(row=0, column=1, sticky="nsew")
        projects_box.grid_columnconfigure(0, weight=1)
        projects_box.grid_rowconfigure(0, weight=1)
        project_canvas = Canvas(projects_box, bg="#f0f4f8", highlightthickness=0)
        project_canvas.grid(row=0, column=0, sticky="nsew", padx=(10, 0), pady=(8, 0))
        project_scroll = ttk.Scrollbar(projects_box, orient="vertical", command=project_canvas.yview)
        project_scroll.grid(row=0, column=1, sticky="ns", padx=(0, 6), pady=(8, 0))
        self.project_access_frame = Frame(project_canvas, bg="#f0f4f8")
        self.project_access_frame.bind(
            "<Configure>",
            lambda event: project_canvas.configure(scrollregion=project_canvas.bbox("all")),
        )
        project_window = project_canvas.create_window((0, 0), window=self.project_access_frame, anchor="nw")
        project_canvas.bind(
            "<Configure>",
            lambda event: project_canvas.itemconfigure(project_window, width=event.width),
        )
        project_canvas.configure(yscrollcommand=project_scroll.set)

        btns = Frame(right, bg="#f0f4f8")
        btns.grid(row=2, column=0, sticky="w", pady=(18, 8))
        Button(
            btns,
            text="New User",
            command=self.clear_form,
            bg="#555",
            fg="white",
            font=("Arial", 10, "bold"),
            width=24,
        ).pack(side=LEFT, padx=(6, 10))
        Button(
            btns,
            text="Save User & Rights",
            command=self.save_current_user,
            bg="#008000",
            fg="white",
            font=("Arial", 10, "bold"),
            width=24,
        ).pack(side=LEFT, padx=(0, 10))
        Button(
            btns,
            text="Refresh",
            command=self.load_users,
            bg="#0066cc",
            fg="white",
            font=("Arial", 10, "bold"),
            width=24,
        ).pack(side=LEFT, padx=(0, 6))

    def load_users(self):
        self.user_list.delete(0, END)
        self.users = list(get_all_users())
        for user in self.users:
            status = "Active" if user["active"] else "Inactive"
            self.user_list.insert(END, f"{user['username']} ({user['role']}, {status})")

    def load_projects(self):
        for widget in self.project_access_frame.winfo_children():
            widget.destroy()
        self.project_vars = {}
        self.projects = list(get_all_project_choices())
        for idx, project in enumerate(self.projects):
            var = BooleanVar(value=False)
            self.project_vars[project["id"]] = var
            label = f"{project['unique_id']} - {project['project_name']}"
            Checkbutton(
                self.project_access_frame,
                text=label,
                variable=var,
                bg="#f0f4f8",
                anchor="w",
                justify=LEFT,
                wraplength=720,
            ).grid(row=idx, column=0, sticky=W, padx=8, pady=3)

    def clear_form(self):
        self.selected_user_id = None
        self.username_var.set("")
        self.password_var.set("")
        self.role_var.set("user")
        self.active_var.set(True)
        for module_key, _ in APP_MODULES:
            self.access_vars[module_key].set(False)
            self.edit_vars[module_key].set(False)
        for var in self.project_vars.values():
            var.set(False)

    def on_user_select(self, event=None):
        sel = self.user_list.curselection()
        if not sel:
            return
        user = self.users[sel[0]]
        self.selected_user_id = user["id"]
        self.username_var.set(user["username"])
        self.password_var.set("")
        self.role_var.set(user["role"])
        self.active_var.set(bool(user["active"]))

        permissions = get_user_permissions(user["id"])
        for module_key, _ in APP_MODULES:
            self.access_vars[module_key].set(permissions.get(module_key, {}).get("access", False))
            self.edit_vars[module_key].set(permissions.get(module_key, {}).get("edit", False))

        assigned_projects = get_user_project_ids(user["id"])
        for project_id, var in self.project_vars.items():
            var.set(int(project_id) in assigned_projects)

    def save_current_user(self):
        username = self.username_var.get().strip()
        password = self.password_var.get()
        role = self.role_var.get()
        if not username:
            messagebox.showerror("Missing", "Username is required.")
            return
        if not self.selected_user_id and not password:
            messagebox.showerror("Missing", "Password is required for a new user.")
            return

        try:
            user_id = save_user(username, password, role, self.active_var.get(), self.selected_user_id)
            permissions = {}
            for module_key, _ in APP_MODULES:
                access = self.access_vars[module_key].get()
                edit = self.edit_vars[module_key].get()
                permissions[module_key] = {"access": access or edit, "edit": edit}
            if role == "admin":
                permissions = {module_key: {"access": True, "edit": True} for module_key, _ in APP_MODULES}
            save_user_permissions(user_id, permissions)
            project_ids = [project_id for project_id, var in self.project_vars.items() if var.get()]
            save_user_projects(user_id, project_ids)
            messagebox.showinfo("Saved", "User and rights saved successfully.")
            keep_window_active(self)
            self.selected_user_id = user_id
            self.load_users()
        except Exception as e:
            messagebox.showerror("Save Error", str(e))
            keep_window_active(self)

    def open_project_registration(self):
        if hasattr(self.parent_app, "show_registration_from_admin"):
            self.parent_app.show_registration_from_admin()
            self.destroy()


if __name__ == "__main__":
    LoginWindow().mainloop()
