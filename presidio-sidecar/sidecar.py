"""
Presidio Redaction Sidecar

A FastAPI service that provides PII redaction using Microsoft Presidio.
Combines ML-based detection (names, emails, locations) with custom regex patterns
(API keys, IDs) into a single optimized pass.

The service loads custom regex rules from redaction_config.yaml at startup.
"""

import yaml
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import List
from presidio_analyzer import AnalyzerEngine, PatternRecognizer, Pattern
from presidio_anonymizer import AnonymizerEngine

app = FastAPI(
    title="Presidio Redaction Sidecar",
    description="PII redaction service using Microsoft Presidio with custom regex patterns",
    version="1.0.0"
)

# Initialize Presidio engines (will be loaded on startup)
analyzer = None
anonymizer = None


def load_custom_rules():
    """
    Load custom regex rules from redaction_config.yaml
    and register them with the Presidio analyzer.

    Returns:
        List of loaded rule entities
    """
    global analyzer

    try:
        with open("redaction_config.yaml", "r") as file:
            config = yaml.safe_load(file)
    except FileNotFoundError:
        print("Warning: redaction_config.yaml not found, using only built-in entities")
        return []
    except yaml.YAMLError as e:
        print(f"Error parsing redaction_config.yaml: {e}")
        return []

    loaded_entities = []
    for rule in config.get("rules", []):
        entity = rule.get("entity")
        pattern = rule.get("pattern")

        if not entity or not pattern:
            print(f"Skipping invalid rule: {rule}")
            continue

        pattern_obj = Pattern(
            name=f"{entity}_pattern",
            regex=pattern,
            score=1.0
        )
        recognizer = PatternRecognizer(
            supported_entity=entity,
            patterns=[pattern_obj]
        )
        analyzer.registry.add_recognizer(recognizer)
        loaded_entities.append(entity)

    print(f"Loaded {len(loaded_entities)} custom regex rules: {', '.join(loaded_entities)}")
    return loaded_entities


@app.on_event("startup")
def startup_event():
    """Initialize Presidio engines and load custom rules on startup."""
    global analyzer, anonymizer

    print("Initializing Presidio Analyzer Engine...")
    analyzer = AnalyzerEngine()

    print("Loading custom regex rules...")
    load_custom_rules()

    print("Initializing Presidio Anonymizer Engine...")
    anonymizer = AnonymizerEngine()

    print("Presidio sidecar startup complete")


class RedactRequest(BaseModel):
    """Request model for bulk redaction."""
    texts: List[str]


class RedactResponse(BaseModel):
    """Response model with redacted texts."""
    redacted_texts: List[str]


@app.get("/")
def root():
    """Health check endpoint."""
    return {"status": "ok", "service": "presidio-sidecar"}


@app.get("/health")
def health():
    """Health check endpoint for container orchestration."""
    return {"status": "healthy"}


@app.post("/redact", response_model=RedactResponse)
def redact(req: RedactRequest):
    """
    Redact PII from a list of texts.

    Runs both ML-based detection (names, emails, etc.) and
    custom regex patterns (API keys, IDs) in a single pass.

    Args:
        req: Request containing list of texts to redact

    Returns:
        Response with redacted texts in the same order
    """
    results = []

    for text in req.texts:
        if not text:
            results.append("")
            continue

        # Analyze runs both ML (Names, Orgs) and injected Regex (Keys, IDs)
        # entities=[] enables all built-in entities plus our custom regex rules
        analysis_results = analyzer.analyze(text=text, entities=[], language="en")

        # Anonymize the detected PII
        anonymized = anonymizer.anonymize(
            text=text,
            analyzer_results=analysis_results
        )
        results.append(anonymized.text)

    return {"redacted_texts": results}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=5001)
