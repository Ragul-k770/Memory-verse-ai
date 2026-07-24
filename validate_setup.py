import sys
print("Starting validation of MemoryVerse AI setup...")

# Test imports
try:
    import fastapi
    import uvicorn
    import pypdf
    print("[SUCCESS] All required Python dependencies are installed.")
except ImportError as e:
    print(f"[FAIL] Missing dependency: {e}")
    sys.exit(1)

# Test AI Engine logic
try:
    from ai_engine import clean_and_tokenize, categorize_document, SimpleVectorDB
    
    # Test tokenization
    tokens = clean_and_tokenize("Python programming with FastAPI and React!")
    assert "python" in tokens
    assert "fastapi" in tokens
    print("[SUCCESS] Tokenizer is working correctly.")
    
    # Test categorization
    category = categorize_document("This is a certificate of completion for React course from Coursera", "react_cert.pdf")
    assert category == "Certifications"
    print("[SUCCESS] Rule-based Categorizer is working correctly.")
    
    # Test Vector Database
    db = SimpleVectorDB()
    chunks = [
        {"doc_id": "doc1", "text": "Python is a popular programming language for Data Science and Machine Learning."},
        {"doc_id": "doc2", "text": "React is a frontend Javascript library for building interactive user interfaces."}
    ]
    db.add_chunks(chunks)
    
    results = db.search("Python machine learning", top_k=1)
    assert len(results) > 0
    assert results[0]["chunk"]["doc_id"] == "doc1"
    print(f"[SUCCESS] Vector Search Cosine Similarity index is functional. Top match score: {results[0]['score']}")

except Exception as e:
    print(f"[FAIL] AI Engine execution failed: {e}")
    sys.exit(1)

print("[SUCCESS] Setup verification passed successfully!")
