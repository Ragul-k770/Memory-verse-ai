import os
import re
import math
import json
import time
import numpy as np
from pypdf import PdfReader
try:
    from docx import Document
except ImportError:
    Document = None

# ─── OpenAI Client Setup ────────────────────────────────────────────────────
try:
    import httpx
    OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "")
    if OPENAI_API_KEY and "your-" not in OPENAI_API_KEY:
        AI_ENABLED = True
        print("[AI Engine] OpenAI API key found. GPT features enabled.")
    else:
        AI_ENABLED = False
        print("[AI Engine] OPENAI_API_KEY not set. Using local TF-IDF search + rule-based fallback.")
except Exception as e:
    AI_ENABLED = False
    print(f"[AI Engine] Init error: {e}")


def _openai_request(endpoint, payload, timeout=30, retries=2):
    """Makes a POST request to OpenAI with retry on 429."""
    key = os.environ.get("OPENAI_API_KEY", "")
    headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}
    last_err = None
    for attempt in range(retries + 1):
        try:
            with httpx.Client(timeout=timeout) as client:
                response = client.post(
                    f"https://api.openai.com{endpoint}",
                    headers=headers,
                    json=payload
                )
                if response.status_code == 429:
                    wait = 2 ** attempt
                    print(f"[OpenAI] 429 Rate limit hit. Waiting {wait}s...")
                    time.sleep(wait)
                    last_err = Exception("429 Too Many Requests")
                    continue
                response.raise_for_status()
                return response.json()
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 429:
                wait = 2 ** attempt
                print(f"[OpenAI] 429 Rate limit. Waiting {wait}s (attempt {attempt+1})...")
                time.sleep(wait)
                last_err = e
                continue
            raise
    raise last_err or Exception("OpenAI request failed after retries")


# ─── Text Extraction ─────────────────────────────────────────────────────────
def extract_text(file_path):
    """Extracts raw text from PDF, DOCX, or TXT file."""
    ext = os.path.splitext(file_path)[1].lower()
    text = ""
    try:
        if ext == ".pdf":
            reader = PdfReader(file_path)
            for page in reader.pages:
                t = page.extract_text()
                if t:
                    text += t + "\n"
        elif ext == ".docx" and Document:
            doc = Document(file_path)
            for para in doc.paragraphs:
                text += para.text + "\n"
        else:
            with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
                text = f.read()
    except Exception as e:
        print(f"Error extracting text from {file_path}: {e}")
    return text


# ─── Metadata Extraction ──────────────────────────────────────────────────────
def _rule_based_metadata(text, filename):
    """Fast, free rule-based metadata extractor."""
    fname_lower = filename.lower()
    if any(k in fname_lower for k in ["cert", "certif", "course", "completion", "coursera", "udemy"]):
        category = "Certifications"
    elif any(k in fname_lower for k in ["intern", "letter", "offer", "appointment"]):
        category = "Internships"
    elif any(k in fname_lower for k in ["resume", "cv"]):
        category = "Academics"
    elif any(k in fname_lower for k in ["project", "report", "system"]):
        category = "Projects"
    elif any(k in fname_lower for k in ["hackathon", "award", "winner", "achievement"]):
        category = "Achievements"
    else:
        # fallback: scan text
        text_lower = text.lower()
        if any(k in text_lower for k in ["certificate", "certification", "certifies"]):
            category = "Certifications"
        elif any(k in text_lower for k in ["internship", "intern at", "joining letter"]):
            category = "Internships"
        elif any(k in text_lower for k in ["hackathon", "first place", "award"]):
            category = "Achievements"
        elif any(k in text_lower for k in ["abstract", "github", "project report"]):
            category = "Projects"
        else:
            category = "Academics"

    year_match = re.search(r'\b(20\d{2})\b', text)
    year = int(year_match.group(1)) if year_match else 2026

    # Extract organization from common patterns
    org = "Unknown"
    for pattern in [r'(?:by|at|from|of)\s+([A-Z][A-Za-z\s&]+(?:LLC|Inc|Ltd|University|Institute|College|Google|Microsoft|Amazon|Meta|Apple|Academy)?)',
                    r'([A-Z][A-Za-z\s]+(?:University|Institute|College|Academy|LLC|Inc|Ltd))']:
        m = re.search(pattern, text)
        if m:
            candidate = m.group(1).strip()
            if 3 < len(candidate) < 60:
                org = candidate
                break

    skills_keywords = [
        "Python", "JavaScript", "TypeScript", "React", "FastAPI", "Node.js", "SQL",
        "Git", "Docker", "Machine Learning", "NLP", "TensorFlow", "PyTorch", "NumPy",
        "Pandas", "RAG", "Vector Database", "AWS", "GCP", "Azure", "CSS", "HTML",
        "REST", "API", "Data Analysis", "Deep Learning", "OpenAI", "LLM", "Gemini"
    ]
    found_skills = [s for s in skills_keywords if s.lower() in text.lower()]

    return {"category": category, "year": year, "organization": org, "skills": found_skills}


def get_ai_metadata(text, filename):
    """Uses GPT-4o-mini to extract metadata; falls back to rule-based."""
    if not AI_ENABLED:
        return _rule_based_metadata(text, filename)

    prompt = f"""Analyze the document named '{filename}'. Return ONLY a valid JSON object with:
- "category": one of ["Certifications","Projects","Internships","Achievements","Academics","Skills"]
- "year": integer year (or 2026 if unknown)
- "organization": the company/university name
- "skills": JSON array of technical skills

Document (first 4000 chars):
{text[:4000]}

Return only valid JSON."""

    try:
        data = _openai_request("/v1/chat/completions", {
            "model": "gpt-4o-mini",
            "messages": [{"role": "user", "content": prompt}],
            "temperature": 0.1,
            "response_format": {"type": "json_object"},
            "max_tokens": 300
        })
        return json.loads(data["choices"][0]["message"]["content"])
    except Exception as e:
        print(f"[OpenAI] Metadata Extraction Error: {e}. Using rule-based fallback.")
        return _rule_based_metadata(text, filename)


_cached_metadata = {}


def categorize_document(text, filename):
    meta = get_ai_metadata(text, filename)
    _cached_metadata[filename] = meta
    return meta["category"]


def extract_metadata(text, filename, category):
    if filename in _cached_metadata:
        return _cached_metadata.pop(filename)
    return get_ai_metadata(text, filename)


# ─── Text Chunking ────────────────────────────────────────────────────────────
def chunk_text(text, doc_id, chunk_size=300):
    words = text.split()
    chunks = []
    step = int(chunk_size * 0.75)
    for i in range(0, len(words), step):
        chunk_words = words[i:i + chunk_size]
        if len(chunk_words) < 20 and chunks:
            continue
        chunks.append({"doc_id": doc_id, "text": " ".join(chunk_words)})
    return chunks


# ─── TF-IDF Vector DB (Free, Local, Always Works) ────────────────────────────
class SimpleVectorDB:
    """
    Primary: Local TF-IDF cosine similarity (fast, free, no API needed).
    Enhanced: OpenAI text-embedding-3-small when available and not rate-limited.
    """
    def __init__(self):
        self.chunks = []
        self.tfidf_matrix = []   # list of {term: tf-idf} dicts
        self.vocab = {}           # term -> idf

    def add_chunks(self, new_chunks):
        if not new_chunks:
            return
        self.chunks.extend(new_chunks)
        self._rebuild_tfidf()

    def _tokenize(self, text):
        return re.findall(r'\b[a-zA-Z][a-zA-Z0-9]+\b', text.lower())

    def _rebuild_tfidf(self):
        """Rebuild TF-IDF index over all chunks."""
        N = len(self.chunks)
        if N == 0:
            return

        # Compute term frequencies per document
        tf_docs = []
        df = {}
        for chunk in self.chunks:
            tokens = self._tokenize(chunk["text"])
            total = max(len(tokens), 1)
            tf = {}
            for t in tokens:
                tf[t] = tf.get(t, 0) + 1
            for t in tf:
                tf[t] /= total
                df[t] = df.get(t, 0) + 1
            tf_docs.append(tf)

        # Compute IDF
        self.vocab = {t: math.log((N + 1) / (df[t] + 1)) + 1 for t in df}

        # Build TF-IDF vectors
        self.tfidf_matrix = []
        for tf in tf_docs:
            vec = {t: tf[t] * self.vocab.get(t, 0) for t in tf}
            self.tfidf_matrix.append(vec)

    def _cosine(self, vec_a, vec_b):
        common = set(vec_a) & set(vec_b)
        if not common:
            return 0.0
        dot = sum(vec_a[t] * vec_b[t] for t in common)
        mag_a = math.sqrt(sum(v * v for v in vec_a.values()))
        mag_b = math.sqrt(sum(v * v for v in vec_b.values()))
        if mag_a == 0 or mag_b == 0:
            return 0.0
        return dot / (mag_a * mag_b)

    def search(self, query, top_k=3):
        """Search using TF-IDF. No API calls needed."""
        if not self.chunks or not self.tfidf_matrix:
            return []

        # Build query TF-IDF vector
        q_tokens = self._tokenize(query)
        total = max(len(q_tokens), 1)
        q_tf = {}
        for t in q_tokens:
            q_tf[t] = q_tf.get(t, 0) + 1
        for t in q_tf:
            q_tf[t] /= total
        q_vec = {t: q_tf[t] * self.vocab.get(t, 0) for t in q_tf}

        if not any(q_vec.values()):
            # If no vocab match, do simple keyword presence search
            results = []
            q_words = set(q_tokens)
            for chunk in self.chunks:
                c_words = set(self._tokenize(chunk["text"]))
                score = len(q_words & c_words) / max(len(q_words), 1)
                if score > 0:
                    results.append({"chunk": chunk, "score": score})
            results.sort(key=lambda x: x["score"], reverse=True)
            return results[:top_k]

        # Cosine similarity ranking
        results = []
        for idx, doc_vec in enumerate(self.tfidf_matrix):
            score = self._cosine(q_vec, doc_vec)
            if score > 0.01:
                results.append({"chunk": self.chunks[idx], "score": score})

        results.sort(key=lambda x: x["score"], reverse=True)
        return results[:top_k]


# ─── RAG Answer Generation ────────────────────────────────────────────────────
def generate_rag_answer(query, search_results, doc_registry):
    """Generates answer using GPT-4o-mini if available, else intelligent keyword summary."""

    if not search_results:
        return ("I couldn't find any relevant documents in your MemoryVerse repository to answer that question. "
                "Try uploading more files or adjusting your query.")

    context_blocks = []
    for r in search_results:
        doc = doc_registry.get(r["chunk"]["doc_id"], {})
        title = doc.get("title", "Unknown Document")
        snippet = r["chunk"]["text"]
        context_blocks.append(f"**Source: {title}**\n{snippet}")

    context_str = "\n\n---\n\n".join(context_blocks)

    if not AI_ENABLED:
        return _local_rag_answer(query, search_results, doc_registry, context_str)

    system_prompt = (
        "You are the MemoryVerse AI Assistant — a professional assistant for a personal digital identity repository. "
        "Answer questions ONLY from the provided context. Use markdown formatting. "
        "Be concise, accurate and professional. "
        "If the answer isn't in the context, say 'I don't have enough information in your repository to answer that.'"
    )

    try:
        data = _openai_request("/v1/chat/completions", {
            "model": "gpt-4o-mini",
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": f"Context:\n{context_str}\n\nQuestion: {query}"}
            ],
            "temperature": 0.3,
            "max_tokens": 500
        })
        return data["choices"][0]["message"]["content"]
    except Exception as e:
        print(f"[OpenAI] RAG Error: {e}. Using local answer.")
        return _local_rag_answer(query, search_results, doc_registry, context_str)


def _local_rag_answer(query, search_results, doc_registry, context_str):
    """Builds a structured answer from search results without any API call."""
    sources = []
    for r in search_results:
        doc = doc_registry.get(r["chunk"]["doc_id"], {})
        title = doc.get("title", "Document")
        org = doc.get("organization", "")
        year = doc.get("year", "")
        skills = doc.get("skills", [])
        snippet = r["chunk"]["text"][:300]
        entry = f"**{title}**"
        if org and org != "Unknown":
            entry += f" — *{org}*"
        if year:
            entry += f" ({year})"
        entry += f"\n> {snippet}..."
        if skills:
            entry += f"\n> Skills: {', '.join(skills[:5])}"
        sources.append(entry)

    answer = f"Based on your MemoryVerse repository, here is what I found about **\"{query}\"**:\n\n"
    answer += "\n\n".join(sources)
    answer += "\n\n*Note: AI-enhanced answers are available when OpenAI API quota is available.*"
    return answer
