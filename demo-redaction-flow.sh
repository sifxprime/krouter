#!/bin/bash
# Demo script showing how redaction flows through the system

echo "=========================================="
echo "PII Redaction Flow Demonstration"
echo "=========================================="
echo ""

echo "1. ORIGINAL REQUEST (from client):"
echo "-----------------------------------"
cat <<'EOF'
POST /v1/messages
{
  "model": "gpt-4",
  "messages": [
    {
      "role": "user",
      "content": "My name is John Doe, email is john.doe@example.com, and phone is 555-123-4567. My OpenAI key is sk-proj-abc123def456"
    }
  ]
}
EOF
echo ""

echo "2. MIDDLEWARE EXTRACTION:"
echo "-------------------------"
echo "Extracted texts for redaction:"
echo "  - 'My name is John Doe, email is john.doe@example.com, and phone is 555-123-4567. My OpenAI key is sk-proj-abc123def456'"
echo ""

echo "3. REQUEST TO PRESIDIO SIDECAR:"
echo "--------------------------------"
cat <<'EOF'
POST http://presidio-sidecar:5001/redact
{
  "texts": [
    "My name is John Doe, email is john.doe@example.com, and phone is 555-123-4567. My OpenAI key is sk-proj-abc123def456"
  ]
}
EOF
echo ""

echo "4. PRESIDIO PROCESSING:"
echo "-----------------------"
echo "ML Detection:"
echo "  - PERSON: 'John Doe' → <PERSON>"
echo "  - EMAIL_ADDRESS: 'john.doe@example.com' → <EMAIL_ADDRESS>"
echo "  - PHONE_NUMBER: '555-123-4567' → <PHONE_NUMBER>"
echo ""
echo "Regex Detection (from redaction_config.yaml):"
echo "  - OPENAI_KEY: 'sk-proj-abc123def456' → <OPENAI_KEY>"
echo ""

echo "5. SIDECAR RESPONSE:"
echo "--------------------"
cat <<'EOF'
{
  "redacted_texts": [
    "My name is <PERSON>, email is <EMAIL_ADDRESS>, and phone is <PHONE_NUMBER>. My OpenAI key is <OPENAI_KEY>"
  ]
}
EOF
echo ""

echo "6. MIDDLEWARE INJECTION:"
echo "------------------------"
echo "Modified request sent to kRouter core:"
cat <<'EOF'
POST /v1/messages
{
  "model": "gpt-4",
  "messages": [
    {
      "role": "user",
      "content": "My name is <PERSON>, email is <EMAIL_ADDRESS>, and phone is <PHONE_NUMBER>. My OpenAI key is <OPENAI_KEY>"
    }
  ]
}
EOF
echo ""

echo "7. REQUEST TO AI PROVIDER:"
echo "--------------------------"
echo "The redacted request is sent to the AI provider (OpenAI, Anthropic, etc.)"
echo "No PII leaves your infrastructure!"
echo ""

echo "=========================================="
echo "Redaction Flow Complete"
echo "=========================================="
echo ""
echo "Key Points:"
echo "  ✓ PII never leaves your local environment"
echo "  ✓ AI provider receives only redacted text"
echo "  ✓ Original request/response flow unchanged"
echo "  ✓ Fail-open: if redaction fails, request continues (logged)"
echo ""
