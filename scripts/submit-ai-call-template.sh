#!/bin/bash
# Submit the ai_call_course_info WhatsApp template to Meta for approval
# Run: bash scripts/submit-ai-call-template.sh

FUNC_URL="https://deylhigsisuexszsmypq.supabase.co/functions/v1/whatsapp-templates"

echo "Getting auth token..."
AUTH_TOKEN=$(curl -s -X POST "https://deylhigsisuexszsmypq.supabase.co/auth/v1/token?grant_type=password" \
  -H "apikey: $(grep VITE_SUPABASE_PUBLISHABLE_KEY .env | cut -d= -f2 | tr -d '"')" \
  -H "Content-Type: application/json" \
  -d '{"email":"siddhant@nimt.ac.in","password":"your_password"}' | jq -r '.access_token')

echo ""
echo "1/1: Submitting ai_call_course_info template..."
curl -s -X POST "$FUNC_URL" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "create",
    "name": "ai_call_course_info",
    "category": "UTILITY",
    "language": "en",
    "body_text": "Hi {{1}}, thank you for speaking with us about {{2}} at NIMT Educational Institutions! 🎓\n\n🏫 Campus: {{3}}\n\n📄 Course Details: {{4}}\n📝 Apply Now: {{5}}\n\nFor questions, reply to this message or call our admissions team.\n\nWe look forward to welcoming you!"
  }' | jq .
echo ""

echo "Done! Check Meta Business Manager for approval status."
echo "Template typically gets approved within a few minutes."
