import os
import uuid
import json
import shutil
import urllib.request
import urllib.parse
import random

# ─── Load .env FIRST so API keys are available before ai_engine initializes ───
def load_env():
    base_dir = os.path.dirname(os.path.abspath(__file__))
    env_path = os.path.join(base_dir, ".env")
    if os.path.exists(env_path):
        with open(env_path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    key, val = line.split("=", 1)
                    os.environ[key.strip()] = val.strip()

load_env()
# ──────────────────────────────────────────────────────────────────────────────

from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from typing import List, Optional

# Import our custom AI engine components (after load_env so keys are set)
from ai_engine import (
    extract_text,
    categorize_document,
    extract_metadata,
    chunk_text,
    SimpleVectorDB,
    generate_rag_answer
)

app = FastAPI(title="MemoryVerse AI Server")

# Enable CORS for frontend requests
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Directories setup
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(BASE_DIR, "static")

if os.environ.get("VERCEL"):
    UPLOAD_DIR = "/tmp/uploads"
    DB_PATH = "/tmp/db.json"
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    # Copy seed db.json to /tmp if not exists
    src_db = os.path.join(BASE_DIR, "db.json")
    if not os.path.exists(DB_PATH) and os.path.exists(src_db):
        try:
            shutil.copy(src_db, DB_PATH)
        except Exception as e:
            print(f"Failed to copy db.json to /tmp: {e}")
else:
    UPLOAD_DIR = os.path.join(BASE_DIR, "uploads")
    DB_PATH = os.path.join(BASE_DIR, "db.json")
    os.makedirs(UPLOAD_DIR, exist_ok=True)

os.makedirs(STATIC_DIR, exist_ok=True)

# Global in-memory data registries
document_registry = {}
vector_db = SimpleVectorDB()

# Seed files setup
MOCK_DOCUMENTS = [
    {
        "filename": "Alex_Dev_Resume.txt",
        "text": """Alex Dev
Email: alex.dev@example.com
Education: Woolworth Institute of Technology, B.S. in Computer Science (Graduation Year: 2026). GPA: 3.9/4.0.
Skills: Python, JavaScript, React, FastAPI, SQL, Git, Docker, Machine Learning, NLP, RAG, Vector Databases.
Experience: Software Engineering Intern at Google (Summer 2025). Built backend data pipelines using FastAPI and implemented retrieval-augmented generation (RAG) models for search queries.
Projects: Developed 'MemoryVerse AI' (2026), an interactive digital identity knowledge repository using React and FastAPI.
Certifications: Python Core Programming Certification from Coursera (2023)."""
    },
    {
        "filename": "Google_Internship_Letter.txt",
        "text": """Google LLC - Internship Completion Certificate
Date: August 25, 2025
To Whom It May Concern,
This is to certify that Alex Dev successfully completed their Software Engineering Internship at Google during the summer of 2025. 
During their time here, Alex joined the Applied AI team and built microservices in Python using FastAPI. They developed semantic search capabilities, integrated in-memory Vector Databases, and designed an optimized RAG pipeline.
We wish Alex the best in their academic and professional pursuits.
Signed,
Applied AI Team Lead, Google"""
    },
    {
        "filename": "MemoryVerse_AI_Project_Report.txt",
        "text": """MemoryVerse AI - Project System Report (2026)
GitHub Repository: github.com/alexdev/memoryverse-ai
Abstract: 
MemoryVerse AI is a next-generation Digital Identity System designed to ingestion user academic documents, resumes, certificates, and reports, and organize them into an intelligent search repository.
Key Technologies: 
React frontend, FastAPI backend, Vanilla CSS glassmorphic design, and custom NLP vector engines for search.
Architecture:
1. Ingestion: Accepts uploads and parses PDF/TXT content.
2. AI Engine: Runs rule-based classification and skill mapping.
3. Relationship Engine: Connects documents to specific Skills and Projects.
4. RAG Chatbot: Uses TF-IDF cosine similarity search to retrieve document chunks and answer questions.
Developed by: Alex Dev in 2026."""
    },
    {
        "filename": "Coursera_Python_Certification.txt",
        "text": """Coursera Certification of Course Completion
Course: Python Core Programming & Data Analysis
Issued to: Alex Dev
Date: November 12, 2023
Authorized Partner: University of Michigan / Coursera
This certification verifies that Alex Dev has completed the core curriculum in Python programming, covering lists, dictionaries, OOP concepts, Pandas, and NumPy libraries."""
    },
    {
        "filename": "Hackathon_Winner_Certificate.txt",
        "text": """Woolworth Hackathon '24 - First Place Award
This certificate of achievement is awarded to Alex Dev and Team NeuralNet for securing 1st Place in the Woolworth Institute of Technology Hackathon held in October 2024.
Project: Developed 'HealthAI', a deep learning model running in TensorFlow for predictive analysis of patient checkups.
Awarded by: Woolworth Institute Academic Dean and WOOBLE Hackathon Committee."""
    }
]

def load_db():
    """Loads document records from db.json and indexes them in the Vector DB."""
    global document_registry, vector_db
    vector_db = SimpleVectorDB()
    
    if os.path.exists(DB_PATH):
        try:
            with open(DB_PATH, "r", encoding="utf-8") as f:
                document_registry = json.load(f)
                
            # Populate Vector DB chunks
            for doc_id, doc in document_registry.items():
                file_path = os.path.join(UPLOAD_DIR, doc["filename"])
                if os.path.exists(file_path):
                    txt = extract_text(file_path)
                    chunks = chunk_text(txt, doc_id)
                    vector_db.add_chunks(chunks)
            print(f"Loaded and indexed {len(document_registry)} documents from db.json.")
            return
        except Exception as e:
            print(f"Failed to load db.json: {e}. Reinitializing database.")
            
    # Database is empty or missing, pre-populate with mock seed data
    document_registry = {}
    for idx, doc_info in enumerate(MOCK_DOCUMENTS):
        doc_id = f"seed-{idx+1}"
        filename = doc_info["filename"]
        file_path = os.path.join(UPLOAD_DIR, filename)
        
        # Save mock text file to uploads/
        with open(file_path, "w", encoding="utf-8") as f:
            f.write(doc_info["text"])
            
        category = categorize_document(doc_info["text"], filename)
        meta = extract_metadata(doc_info["text"], filename, category)
        
        document_registry[doc_id] = {
            "id": doc_id,
            "filename": filename,
            "title": filename.rsplit('.', 1)[0].replace('_', ' ').title(),
            "category": category,
            "year": meta.get("year", 2026),
            "organization": meta.get("organization", "Unknown"),
            "skills": meta.get("skills", []),
            "size": len(doc_info["text"].encode('utf-8'))
        }
        
        chunks = chunk_text(doc_info["text"], doc_id)
        vector_db.add_chunks(chunks)
        
    save_db()
    print("Database seeded with default mock documents.")

def save_db():
    """Saves document registry to db.json."""
    with open(DB_PATH, "w", encoding="utf-8") as f:
        json.dump(document_registry, f, indent=4)

@app.on_event("startup")
def startup_event():
    load_db()

@app.get("/api/documents")
def get_documents():
    """Returns all document metadata records."""
    return list(document_registry.values())

@app.post("/api/upload")
async def upload_file(file: UploadFile = File(...)):
    """Handles file uploads, text extraction, auto-categorization, metadata parsing, and vector indexing."""
    global vector_db
    try:
        # Create unique identifier
        doc_id = str(uuid.uuid4())
        safe_filename = f"{doc_id}_{file.filename}"
        file_path = os.path.join(UPLOAD_DIR, safe_filename)
        
        # Save file to uploads folder
        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
            
        # Extract text content
        extracted_text = extract_text(file_path)
        if not extracted_text.strip():
            # Fallback for scanned PDFs / image cards
            clean_name = file.filename.rsplit('.', 1)[0].replace('_', ' ').replace('-', ' ').title()
            extracted_text = (
                f"Document: {clean_name}\n"
                f"Type: Scanned Image or ID Document\n"
                f"Description: This is a scanned digital identification card or credentials document named {file.filename}.\n"
                f"Skills: Identification, Credentials, Verification, Authentication."
            )
            
        # Analyze file size
        file_size = os.path.getsize(file_path)
        
        # Ingest and classify document
        category = categorize_document(extracted_text, file.filename)
        meta = extract_metadata(extracted_text, file.filename, category)
        
        # Save document record
        document_registry[doc_id] = {
            "id": doc_id,
            "filename": safe_filename,
            "title": file.filename.rsplit('.', 1)[0].replace('_', ' ').title(),
            "category": category,
            "year": meta["year"],
            "organization": meta["organization"],
            "skills": meta["skills"],
            "size": file_size
        }
        
        save_db()
        
        # Semantic chunking and vector database ingestion
        chunks = chunk_text(extracted_text, doc_id)
        vector_db.add_chunks(chunks)
        
        return document_registry[doc_id]
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to process file: {str(e)}")

@app.delete("/api/documents/{doc_id}")
def delete_document(doc_id: str):
    """Deletes a document from records, disk, and re-indexes the vector DB."""
    if doc_id not in document_registry:
        raise HTTPException(status_code=404, detail="Document not found")
        
    doc = document_registry.pop(doc_id)
    file_path = os.path.join(UPLOAD_DIR, doc["filename"])
    
    if os.path.exists(file_path):
        try:
            os.remove(file_path)
        except Exception as e:
            print(f"Error deleting file {file_path}: {e}")
            
    save_db()
    
    # Reload/Re-index vector database completely without the deleted file
    load_db()
    return {"message": "Document deleted successfully"}

@app.get("/api/timeline")
def get_timeline():
    """Generates the structured digital journey timeline sorted chronologically."""
    events = []
    for doc in document_registry.values():
        events.append({
            "id": doc["id"],
            "title": doc["title"],
            "category": doc["category"],
            "year": doc["year"],
            "organization": doc["organization"],
            "skills": doc["skills"]
        })
    # Sort chronologically by year
    events.sort(key=lambda x: (x["year"] if x["year"] else 0, x["title"]))
    return events

@app.get("/api/relationships")
def get_relationships():
    """Returns a nodes and links graph representing the relational model."""
    nodes = []
    links = []
    
    # Track existing nodes to prevent duplicates
    # Types: "document", "skill", "category"
    node_set = set()
    
    # Base Categories
    categories = ["Projects", "Skills", "Certifications", "Internships", "Achievements", "Academics"]
    for cat in categories:
        node_id = f"cat-{cat}"
        nodes.append({
            "id": node_id,
            "label": cat,
            "type": "category",
            "val": 15
        })
        node_set.add(node_id)
        
    # Document nodes & Category connections
    for doc in document_registry.values():
        doc_node_id = f"doc-{doc['id']}"
        nodes.append({
            "id": doc_node_id,
            "label": doc["title"],
            "type": "document",
            "category": doc["category"],
            "val": 10
        })
        
        # Link document to its Category node
        links.append({
            "source": doc_node_id,
            "target": f"cat-{doc['category']}",
            "type": "belongs_to"
        })
        
        # Link skills
        for skill in doc["skills"]:
            skill_node_id = f"skill-{skill.lower()}"
            if skill_node_id not in node_set:
                nodes.append({
                    "id": skill_node_id,
                    "label": skill,
                    "type": "skill",
                    "val": 8
                })
                node_set.add(skill_node_id)
                
                # Link skill to the master "Skills" category node
                links.append({
                    "source": skill_node_id,
                    "target": "cat-Skills",
                    "type": "is_skill"
                })
                
            # Connect the Document to the Skill
            links.append({
                "source": doc_node_id,
                "target": skill_node_id,
                "type": "mentions_skill"
            })
            
    return {"nodes": nodes, "links": links}

@app.post("/api/search")
def search_documents(query: dict):
    """Executes a semantic TF-IDF query returning matching documents and scores."""
    q_str = query.get("query", "")
    if not q_str:
        return []
        
    search_results = vector_db.search(q_str, top_k=5)
    results = []
    
    for res in search_results:
        doc_id = res["chunk"]["doc_id"]
        doc = document_registry.get(doc_id)
        if doc:
            results.append({
                "doc_id": doc_id,
                "title": doc["title"],
                "filename": doc["filename"],
                "category": doc["category"],
                "score": res["score"],
                "text": res["chunk"]["text"]
            })
    return results

@app.post("/api/chat")
def chat_assistant(payload: dict):
    """Retrieves context and synthesizes RAG chat answer."""
    query = payload.get("message", "")
    if not query:
        return {"answer": "How can I help you navigate your MemoryVerse AI records today?"}
        
    search_results = vector_db.search(query, top_k=3)
    answer = generate_rag_answer(query, search_results, document_registry)
    
    return {
        "answer": answer,
        "retrieved_count": len(search_results)
    }

@app.post("/v1/chat/completions")
def openai_compat_chat(payload: dict):
    """OpenAI-compatible chat completion endpoint linking to our semantic vector RAG engine."""
    messages = payload.get("messages", [])
    if not messages:
        raise HTTPException(status_code=400, detail="Messages array is required.")
        
    user_query = ""
    for msg in reversed(messages):
        if msg.get("role") == "user":
            user_query = msg.get("content", "")
            break
            
    if not user_query:
        answer = "No user query found in messages history."
    else:
        # Search vector DB and generate RAG answer
        search_results = vector_db.search(user_query, top_k=3)
        answer = generate_rag_answer(user_query, search_results, document_registry)
        
    import time
    completion_id = f"chatcmpl-{uuid.uuid4().hex[:12]}"
    
    return {
        "id": completion_id,
        "object": "chat.completion",
        "created": int(time.time()),
        "model": payload.get("model", "gpt-4o-mini"),
        "choices": [{
            "index": 0,
            "message": {
                "role": "assistant",
                "content": answer
            },
            "finish_reason": "stop"
        }],
        "usage": {
            "prompt_tokens": len(user_query.split()) + 10,
            "completion_tokens": len(answer.split()),
            "total_tokens": len(user_query.split()) + len(answer.split()) + 10
        }
    }

# In-memory dictionary to store active phone OTP codes for verification
phone_otp_store = {}

def verify_google_id_token(id_token: str):
    """Natively verifies a Google ID Token using Google's API endpoint."""
    try:
        url = f"https://oauth2.googleapis.com/tokeninfo?id_token={urllib.parse.quote(id_token)}"
        req = urllib.request.Request(url, method="GET")
        with urllib.request.urlopen(req) as response:
            data = json.loads(response.read().decode("utf-8"))
            
            # Verify client ID if set in environment
            client_id = os.environ.get("GOOGLE_CLIENT_ID")
            if client_id and data.get("aud") != client_id:
                print("[GOOGLE AUTH] Token audience mismatch.")
                return None
                
            return data
    except Exception as e:
        print(f"[GOOGLE AUTH] Google ID token verification failed: {e}")
        return None

def send_twilio_sms(to_number: str, message_body: str):
    """Natively sends an SMS message via Twilio API using urllib."""
    account_sid = os.environ.get("TWILIO_ACCOUNT_SID")
    auth_token = os.environ.get("TWILIO_AUTH_TOKEN")
    from_number = os.environ.get("TWILIO_PHONE_NUMBER")
    
    if not all([account_sid, auth_token, from_number]) or "your-" in account_sid or "your-" in auth_token:
        print("[TWILIO] Credentials not fully configured in .env. Falling back to sandbox output.")
        return False
        
    try:
        import base64
        auth_str = f"{account_sid}:{auth_token}"
        auth_bytes = auth_str.encode("utf-8")
        auth_base64 = base64.b64encode(auth_bytes).decode("utf-8")
        
        data = urllib.parse.urlencode({
            "To": to_number,
            "From": from_number,
            "Body": message_body
        }).encode("utf-8")
        
        url = f"https://api.twilio.com/2010-04-01/Accounts/{account_sid}/Messages.json"
        req = urllib.request.Request(url, data=data, method="POST")
        req.add_header("Authorization", f"Basic {auth_base64}")
        
        with urllib.request.urlopen(req) as response:
            res_data = json.loads(response.read().decode("utf-8"))
            print(f"[TWILIO] SMS successfully sent. Message SID: {res_data.get('sid')}")
            return True
    except Exception as e:
        print(f"[TWILIO] Failed to send SMS: {e}")
        return False

@app.get("/api/auth/config")
def get_auth_config():
    client_id = os.environ.get("GOOGLE_CLIENT_ID", "")
    return {
        "google_client_id": client_id if client_id and "your-" not in client_id else ""
    }

@app.post("/api/auth/google/next")
def google_next(payload: dict):
    email = payload.get("email", "").strip()
    if not email or "@" not in email:
        raise HTTPException(status_code=400, detail="Invalid email address format.")
    return {"success": True, "email": email}

@app.post("/api/auth/google/signin")
def google_signin(payload: dict):
    # Support both real Google Token ID and simulated Email/Password signin
    id_token = payload.get("id_token")
    if id_token:
        user_data = verify_google_id_token(id_token)
        if user_data:
            email = user_data.get("email")
            display_name = user_data.get("name", email.split("@")[0].title())
            return {
                "success": True,
                "auth_state": f"google-{email}",
                "display_name": display_name
            }
        else:
            raise HTTPException(status_code=400, detail="Invalid Google ID Token or signature verification failed.")

    # Email/Password Fallback
    email = payload.get("email", "").strip()
    password = payload.get("password", "")
    if not email or "@" not in email:
        raise HTTPException(status_code=400, detail="Invalid email address.")
    if not password or len(password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters.")
    
    # Extract display name from email
    name_part = email.split("@")[0]
    display_name = " ".join([word.capitalize() for word in name_part.replace(".", " ").replace("-", " ").replace("_", " ").split()])
    
    return {
        "success": True,
        "auth_state": f"google-{email}",
        "display_name": display_name
    }

@app.post("/api/auth/phone/send-otp")
def phone_send_otp(payload: dict):
    phone = payload.get("phone", "").strip()
    if not phone:
        raise HTTPException(status_code=400, detail="Phone number is required.")
    
    otp = str(random.randint(1000, 9999))
    phone_otp_store[phone] = otp
    
    message = f"MemoryVerse AI Verification Code: {otp}"
    sms_sent = send_twilio_sms(phone, message)
    
    print(f"\n[BACKEND OTP SENT] Verification sent to {phone}. Code: {otp} (Real SMS Sent: {sms_sent})\n")
    
    return {
        "success": True,
        "otp": otp,
        "sms_sent": sms_sent,
        "message": f"Verification code sent to {phone}."
    }

@app.post("/api/auth/phone/verify-otp")
def phone_verify_otp(payload: dict):
    phone = payload.get("phone", "").strip()
    code = payload.get("code", "").strip()
    
    if not phone or not code:
        raise HTTPException(status_code=400, detail="Phone and verification code are required.")
    
    saved_otp = phone_otp_store.get(phone)
    if saved_otp and saved_otp == code:
        phone_otp_store.pop(phone, None)
        return {
            "success": True,
            "auth_state": f"phone-{phone}",
            "display_name": f"Alex ({phone[-4:] if len(phone) > 4 else phone})"
        }
    else:
        raise HTTPException(status_code=400, detail="Invalid verification code. Please check and try again.")

import httpx

@app.get("/api/realtime-token")
async def get_realtime_token():
    OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY")
    if not OPENAI_API_KEY or "your-" in OPENAI_API_KEY:
        raise HTTPException(status_code=500, detail="OPENAI_API_KEY not configured")
        
    headers = {
        "Authorization": f"Bearer {OPENAI_API_KEY}",
        "Content-Type": "application/json"
    }
    
    payload = {
        "model": "gpt-4o-realtime-preview-2024-10-01",
        "voice": "verse"
    }
    
    async with httpx.AsyncClient() as client:
        response = await client.post(
            "https://api.openai.com/v1/realtime/sessions",
            headers=headers,
            json=payload
        )
        
        if response.status_code != 200:
            raise HTTPException(status_code=response.status_code, detail=response.text)
            
        data = response.json()
        return {"client_secret": data.get("client_secret")}

# Serves static files
app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")
