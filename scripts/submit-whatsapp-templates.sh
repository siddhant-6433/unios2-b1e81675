#!/bin/bash
# Submit 3 new WhatsApp templates to Meta for approval
# Run from project root: bash scripts/submit-whatsapp-templates.sh
# Requires: you must be logged into supabase CLI and have a valid session token

echo "Submitting WhatsApp templates to Meta via whatsapp-templates edge function..."
echo ""

SUPABASE_URL="https://deylhigsisuexszsmypq.supabase.co"
FUNC_URL="$SUPABASE_URL/functions/v1/whatsapp-templates"

# You need to paste a valid super_admin JWT token here
if [ -z "$AUTH_TOKEN" ]; then
  echo "ERROR: Set AUTH_TOKEN env var to a valid super_admin JWT"
  echo "Usage: AUTH_TOKEN=eyJ... bash scripts/submit-whatsapp-templates.sh"
  exit 1
fi

# Template 1: Staff/Employee Welcome
echo "1/3: Submitting staff_welcome template..."
curl -s -X POST "$FUNC_URL" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "create",
    "name": "staff_welcome",
    "category": "UTILITY",
    "language": "en",
    "body_text": "Welcome to NIMT Educational Institutions, {{1}}! 🎓\n\nYour account has been created.\n📧 Login: {{2}}\n👤 Role: {{3}}\n🏫 Campus: {{4}}\n\nPlease login at https://uni.nimt.ac.in to get started.\n\nFor any assistance, contact the admin office."
  }' | jq .
echo ""

# Template 2: Student/Parent Welcome (on PAN/AN creation)
echo "2/3: Submitting student_welcome template..."
curl -s -X POST "$FUNC_URL" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "create",
    "name": "student_welcome",
    "category": "UTILITY",
    "language": "en",
    "body_text": "Congratulations {{1}}! 🎉\n\nWelcome to NIMT Educational Institutions.\n\n📋 Admission No: {{2}}\n📚 Course: {{3}}\n🏫 Campus: {{4}}\n\nYou can access the student portal at https://uni.nimt.ac.in.\n\nWe wish you a great academic journey ahead!"
  }' | jq .
echo ""

# Template 3: Applicant Welcome (on application start)
echo "3/3: Submitting applicant_welcome template..."
curl -s -X POST "$FUNC_URL" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "create",
    "name": "applicant_welcome",
    "category": "UTILITY",
    "language": "en",
    "body_text": "Hi {{1}}, thank you for starting your application at NIMT Educational Institutions! 📝\n\nYour Application ID: {{2}}\nCourse: {{3}}\n\nComplete your application at https://uni.nimt.ac.in/apply/nimt\n\nOur admissions team is here to help. Feel free to reach out anytime!"
  }' | jq .
echo ""

echo "Done! Check Meta Business Manager for approval status."
echo "Templates typically get approved within a few minutes."
