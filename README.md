# 🧠 MemoryVerse AI - Digital Identity Knowledge Repository

**MemoryVerse AI** is an intelligent, full-stack digital identity repository and knowledge retrieval system. It ingests your professional documents—resumes, certificates, internship letters, project reports, and skill cards—auto-categorizes them using Machine Learning/NLP, builds a dynamic relational network graph, and allows you to query your career footprint using an AI RAG Chatbot and a Real-time Voice Assistant.

---

## ✨ Features

- 📊 **Knowledge Analytics Dashboard**: Live metrics, category distribution, and an interactive extracted skill cloud.
- 📁 **AI Data Ingestion Hub**: Upload PDF, DOCX, or TXT documents with real-time text parsing and automatic metadata extraction.
- 🔗 **Relational Knowledge Graph**: Interactive canvas visualizing connections between Documents, Categories, and Skills.
- ⏱️ **Digital Journey Timeline**: Chronological map of your milestones, certifications, and work experience.
- 💬 **Smart RAG Assistant**: Query your footprint in natural language using **OpenAI GPT-4o-mini** with local TF-IDF semantic vector fallback.
- 🎙️ **Real-time Voice Assistant**: Talk directly to your digital identity using **OpenAI Realtime WebRTC**.
- 🔔 **Real-time Notifications**: Dropdown alert system tracking identity syncing, document ingestion, and AI responses.
- 🔐 **Multi-Modal Authentication**: Supports Google Sign-In and Mobile OTP verification.

---

## 🛠️ Tech Stack

- **Backend**: Python 3.14+, FastAPI, Uvicorn, PyPDF, python-docx, NumPy, HTTPX
- **Frontend**: HTML5, Vanilla CSS (Glassmorphism design system), JavaScript (ES6+), FontAwesome
- **AI Models**: OpenAI GPT-4o-mini, OpenAI Realtime API (WebRTC), TF-IDF Vector Search

---

## 🚀 Quick Start

### 1. Clone the Repository
```bash
git clone https://github.com/Ragul-k770/Memory-verse-ai.git
cd Memory-verse-ai
```

### 2. Install Dependencies
```bash
pip install fastapi uvicorn pypdf python-docx numpy httpx
```

### 3. Environment Configuration
Create a `.env` file in the root directory:
```env
# OpenAI API Key (For RAG Chatbot & Realtime Voice Assistant)
OPENAI_API_KEY=your-openai-api-key-here

# Optional: Google OAuth Client ID
GOOGLE_CLIENT_ID=your-google-client-id-here

# Optional: Twilio SMS Configuration for Phone OTP
TWILIO_ACCOUNT_SID=your-twilio-sid-here
TWILIO_AUTH_TOKEN=your-twilio-token-here
TWILIO_PHONE_NUMBER=your-twilio-phone-number-here
```

### 4. Run the Application
```bash
python -m uvicorn main:app --host 127.0.0.1 --port 8000
```
Open your browser and navigate to **[http://127.0.0.1:8000](http://127.0.0.1:8000)**.

---

## 📜 API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/documents` | Retrieve all document metadata records |
| `POST` | `/api/upload` | Ingest and parse PDF/DOCX/TXT file |
| `DELETE` | `/api/documents/{id}` | Delete a document and re-index vector database |
| `GET` | `/api/timeline` | Get chronological career events |
| `GET` | `/api/relationships` | Get nodes and links for the knowledge graph |
| `POST` | `/api/search` | Perform TF-IDF / vector similarity search |
| `POST` | `/api/chat` | Query RAG Chatbot assistant |
| `GET` | `/api/realtime-token` | Generate short-lived token for OpenAI Realtime Voice WebRTC |

---

## 🛡️ License

Distributed under the MIT License. See `LICENSE` for more information.
