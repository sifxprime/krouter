# Multi-stage build for Presidio Redaction Sidecar
# Optimized for small image size and fast startup

FROM python:3.11.16-slim AS builder

# Set working directory
WORKDIR /app

# Install build dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements first for better caching
COPY requirements.txt .

# Install Python dependencies system-wide
RUN pip install --no-cache-dir -r requirements.txt

# Download spaCy model in build stage
RUN python -m spacy download en_core_web_lg


# Final stage
FROM python:3.11.16-slim

# Set working directory
WORKDIR /app

# Create non-root user for security
RUN groupadd -r presidio && useradd -r -g presidio presidio

# Install runtime dependencies only
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Copy Python packages from builder
COPY --from=builder /usr/local /usr/local

# Ensure PATH includes /usr/local/bin
ENV PATH=/usr/local/bin:$PATH

# Copy application files
COPY sidecar.py .
COPY hot_reload.py .
COPY redaction_config.yaml .

# Create directory for potential caching
RUN mkdir -p /app/cache && chown -R presidio:presidio /app

# Switch to non-root user
USER presidio

# Expose port
EXPOSE 5001

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:5001/health').read()" || exit 1

# Run with uvicorn for production
CMD ["python", "-m", "uvicorn", "sidecar:app", "--host", "0.0.0.0", "--port", "5001", "--workers", "4"]
