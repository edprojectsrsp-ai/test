import os
import threading
from datetime import datetime
from tkinter import *
from tkinter import ttk, messagebox


BASE_DIR = os.path.dirname(os.path.abspath(__file__))
REPOSITORY_FOLDER = os.getenv(
    "PROJECT_BRAIN_REPOSITORY_DIR",
    os.path.join(BASE_DIR, "Repository"),
)
VECTOR_DB_PATH = os.getenv(
    "PROJECT_BRAIN_VECTOR_DB_DIR",
    os.path.join(BASE_DIR, "vector_db"),
)
EMBEDDING_MODEL = os.getenv(
    "PROJECT_BRAIN_EMBEDDING_MODEL",
    "sentence-transformers/all-MiniLM-L6-v2",
)
LLM_MODEL = os.getenv("PROJECT_BRAIN_LLM_MODEL", "llama3.2:3b")


class LocalAIAssistant:
    def __init__(self, parent, main_app=None):
        self.parent = parent
        self.main_app = main_app
        self.qa_chain = None
        self.vectorstore = None
        self.embeddings = None
        self.llm = None
        self.ai_modules = None

        os.makedirs(REPOSITORY_FOLDER, exist_ok=True)
        os.makedirs(VECTOR_DB_PATH, exist_ok=True)

        self.build_ui()
        self.initialize_ai()

    def build_ui(self):
        self.win = Toplevel(self.parent)
        self.win.title("Local AI Assistant - Project Brain")
        self.win.geometry("1100x750")
        self.win.configure(bg="#f0f4f8")

        header = Frame(self.win, bg="#003087", height=60)
        header.pack(fill=X)
        Label(
            header,
            text="LOCAL AI DOCUMENT ASSISTANT",
            bg="#003087",
            fg="white",
            font=("Arial", 18, "bold"),
        ).pack(pady=12)

        self.status_var = StringVar(value="Initializing Local AI...")
        Label(
            self.win,
            textvariable=self.status_var,
            bg="#f0f4f8",
            fg="#003087",
            font=("Arial", 10, "bold"),
        ).pack(pady=5)

        repo_row = Frame(self.win, bg="#f0f4f8")
        repo_row.pack(fill=X, padx=15, pady=(2, 6))
        Label(
            repo_row,
            text=f"Repository: {REPOSITORY_FOLDER}",
            bg="#f0f4f8",
            fg="#334155",
            font=("Arial", 9),
            anchor="w",
        ).pack(side=LEFT, fill=X, expand=True)

        chat_frame = Frame(self.win, bg="#f0f4f8")
        chat_frame.pack(fill=BOTH, expand=True, padx=15, pady=10)

        self.chat_history = Text(
            chat_frame,
            wrap=WORD,
            font=("Arial", 11),
            bg="white",
            state="disabled",
            height=25,
        )
        self.chat_history.pack(side=LEFT, fill=BOTH, expand=True)

        scrollbar = ttk.Scrollbar(chat_frame, command=self.chat_history.yview)
        scrollbar.pack(side=RIGHT, fill=Y)
        self.chat_history.configure(yscrollcommand=scrollbar.set)

        input_frame = Frame(self.win, bg="#f0f4f8")
        input_frame.pack(fill=X, padx=15, pady=10)
        input_frame.grid_columnconfigure(0, weight=1)

        self.query_var = StringVar()
        query_entry = Entry(input_frame, textvariable=self.query_var, font=("Arial", 12))
        query_entry.grid(row=0, column=0, sticky="ew", padx=(0, 8))
        query_entry.bind("<Return>", lambda _event: self.ask_question())

        self.ask_button = Button(
            input_frame,
            text="Ask AI",
            command=self.ask_question,
            bg="#008000",
            fg="white",
            font=("Arial", 11, "bold"),
            width=12,
            state=DISABLED,
        )
        self.ask_button.grid(row=0, column=1, padx=5)

        self.rebuild_button = Button(
            input_frame,
            text="Rebuild Index",
            command=self.rebuild_index,
            bg="#7c3aed",
            fg="white",
            font=("Arial", 10, "bold"),
            width=14,
            state=DISABLED,
        )
        self.rebuild_button.grid(row=0, column=2, padx=5)

        Label(
            self.win,
            text="100% local - no internet - your data stays here",
            bg="#f0f4f8",
            fg="#666",
            font=("Arial", 9),
        ).pack(pady=5)

    def run_on_ui(self, callback):
        self.win.after(0, callback)

    def set_status(self, text):
        self.run_on_ui(lambda: self.status_var.set(text))

    def set_ready_state(self, enabled):
        state = NORMAL if enabled else DISABLED
        self.run_on_ui(lambda: (self.ask_button.config(state=state), self.rebuild_button.config(state=state)))

    def load_ai_modules(self):
        if self.ai_modules:
            return self.ai_modules
        try:
            from langchain.text_splitter import RecursiveCharacterTextSplitter
            from langchain.chains import RetrievalQA
            from langchain_core.documents import Document
            from langchain_community.document_loaders import (
                PyPDFLoader,
                TextLoader,
                UnstructuredExcelLoader,
                UnstructuredWordDocumentLoader,
            )
            from langchain_community.embeddings import HuggingFaceEmbeddings
            from langchain_community.llms import Ollama
            from langchain_community.vectorstores import Chroma
            import pytesseract
            from PIL import Image
        except ImportError as exc:
            raise RuntimeError(
                "Local AI dependencies are not installed. Install langchain, "
                "langchain-community, langchain-core, chromadb, sentence-transformers, "
                "pillow, pytesseract, and the unstructured document loaders."
            ) from exc

        self.ai_modules = {
            "Chroma": Chroma,
            "Document": Document,
            "HuggingFaceEmbeddings": HuggingFaceEmbeddings,
            "Image": Image,
            "Ollama": Ollama,
            "PyPDFLoader": PyPDFLoader,
            "RetrievalQA": RetrievalQA,
            "RecursiveCharacterTextSplitter": RecursiveCharacterTextSplitter,
            "TextLoader": TextLoader,
            "UnstructuredExcelLoader": UnstructuredExcelLoader,
            "UnstructuredWordDocumentLoader": UnstructuredWordDocumentLoader,
            "pytesseract": pytesseract,
        }
        return self.ai_modules

    def initialize_ai(self):
        def init_thread():
            try:
                modules = self.load_ai_modules()

                self.set_status("Loading embedding model...")
                self.embeddings = modules["HuggingFaceEmbeddings"](model_name=EMBEDDING_MODEL)

                self.set_status("Loading local LLM from Ollama...")
                self.llm = modules["Ollama"](model=LLM_MODEL, temperature=0.1)

                self.set_status("Loading vector database...")
                vectorstore_ready = self.load_or_create_vectorstore()
                if not vectorstore_ready:
                    return

                self.set_status("Local AI ready. Ask anything about your documents.")
                self.add_message(
                    "AI",
                    "Hello. I can read documents in the Repository folder and answer questions from them.",
                )
                self.set_ready_state(True)
            except Exception as exc:
                self.set_ready_state(False)
                self.set_status(f"Error: {exc}")
                self.run_on_ui(lambda: messagebox.showerror("AI Error", f"Failed to initialize AI:\n{exc}"))

        threading.Thread(target=init_thread, daemon=True).start()

    def load_or_create_vectorstore(self):
        modules = self.load_ai_modules()
        if os.path.exists(os.path.join(VECTOR_DB_PATH, "chroma.sqlite3")):
            self.vectorstore = modules["Chroma"](
                persist_directory=VECTOR_DB_PATH,
                embedding_function=self.embeddings,
            )
            self.build_qa_chain()
            return True
        else:
            self.rebuild_index()
            return False

    def build_qa_chain(self):
        modules = self.load_ai_modules()
        if not self.vectorstore:
            return None
        self.qa_chain = modules["RetrievalQA"].from_chain_type(
            llm=self.llm,
            retriever=self.vectorstore.as_retriever(search_kwargs={"k": 6}),
            chain_type="stuff",
        )
        return self.qa_chain

    def rebuild_index(self):
        if not self.embeddings or not self.llm:
            self.set_status("AI is still loading. Please try again in a moment.")
            return

        self.set_ready_state(False)
        self.set_status("Rebuilding document index. Please wait...")

        def rebuild_thread():
            try:
                modules = self.load_ai_modules()
                documents = self.load_all_documents()
                if not documents:
                    self.vectorstore = None
                    self.qa_chain = None
                    self.set_status("No documents found in Repository.")
                    self.add_message("AI", "No supported documents were found in the Repository folder.")
                    return

                text_splitter = modules["RecursiveCharacterTextSplitter"](
                    chunk_size=800,
                    chunk_overlap=100,
                )
                chunks = text_splitter.split_documents(documents)

                self.vectorstore = modules["Chroma"].from_documents(
                    documents=chunks,
                    embedding=self.embeddings,
                    persist_directory=VECTOR_DB_PATH,
                )
                if hasattr(self.vectorstore, "persist"):
                    self.vectorstore.persist()

                self.build_qa_chain()
                self.set_status(f"Index rebuilt. {len(chunks)} chunks indexed.")
                self.add_message("AI", f"Index updated successfully. I indexed {len(chunks)} document chunks.")
            except Exception as exc:
                self.set_status(f"Error: {exc}")
                self.add_message("AI", f"Error while rebuilding index: {exc}")
            finally:
                self.set_ready_state(bool(self.vectorstore))

        threading.Thread(target=rebuild_thread, daemon=True).start()

    def load_all_documents(self):
        modules = self.load_ai_modules()
        documents = []
        loader_map = {
            ".pdf": modules["PyPDFLoader"],
            ".docx": modules["UnstructuredWordDocumentLoader"],
            ".doc": modules["UnstructuredWordDocumentLoader"],
            ".xlsx": modules["UnstructuredExcelLoader"],
            ".xls": modules["UnstructuredExcelLoader"],
            ".txt": modules["TextLoader"],
            ".md": modules["TextLoader"],
        }

        for root, _, files in os.walk(REPOSITORY_FOLDER):
            for filename in files:
                path = os.path.join(root, filename)
                ext = os.path.splitext(filename)[1].lower()
                try:
                    if ext in loader_map:
                        documents.extend(loader_map[ext](path).load())
                    elif ext in (".png", ".jpg", ".jpeg", ".tiff", ".tif"):
                        image = modules["Image"].open(path)
                        text = modules["pytesseract"].image_to_string(image)
                        if text.strip():
                            documents.append(
                                modules["Document"](
                                    page_content=text,
                                    metadata={"source": path},
                                )
                            )
                except Exception as exc:
                    print(f"Skipped {path}: {exc}")
        return documents

    def ask_question(self):
        query = self.query_var.get().strip()
        if not query:
            return
        if not self.vectorstore:
            self.add_message("AI", "Please add documents to the Repository and rebuild the index first.")
            return

        self.add_message("You", query)
        self.query_var.set("")
        self.set_ready_state(False)
        self.set_status("Thinking...")

        def answer_thread():
            try:
                chain = self.qa_chain or self.build_qa_chain()
                result = chain.invoke({"query": query})
                answer = result.get("result", "Sorry, I could not find relevant information.")
                self.add_message("AI", answer)
                self.set_status("Ready")
            except Exception as exc:
                self.add_message("AI", f"Error: {exc}")
                self.set_status("Error occurred")
            finally:
                self.set_ready_state(True)

        threading.Thread(target=answer_thread, daemon=True).start()

    def add_message(self, sender, message):
        def append():
            self.chat_history.configure(state="normal")
            timestamp = datetime.now().strftime("%H:%M")
            self.chat_history.insert(END, f"[{timestamp}] {sender}: {message}\n\n")
            self.chat_history.configure(state="disabled")
            self.chat_history.see(END)

        self.run_on_ui(append)


if __name__ == "__main__":
    root = Tk()
    root.withdraw()
    LocalAIAssistant(root)
    root.mainloop()
