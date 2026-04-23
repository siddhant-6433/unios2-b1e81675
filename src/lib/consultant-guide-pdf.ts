// Generates a downloadable PDF guide for consultants using jsPDF
import jsPDF from "jspdf";

export function generateConsultantGuidePDF() {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 50;
  let y = margin;

  const addHeading = (text: string, size = 20) => {
    if (y > pageHeight - 100) { doc.addPage(); y = margin; }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(size);
    doc.setTextColor(20, 20, 20);
    doc.text(text, margin, y);
    y += size + 8;
  };

  const addSubheading = (text: string) => {
    if (y > pageHeight - 80) { doc.addPage(); y = margin; }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.setTextColor(40, 40, 40);
    doc.text(text, margin, y);
    y += 18;
  };

  const addParagraph = (text: string) => {
    if (y > pageHeight - 60) { doc.addPage(); y = margin; }
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10.5);
    doc.setTextColor(70, 70, 70);
    const lines = doc.splitTextToSize(text, pageWidth - margin * 2);
    doc.text(lines, margin, y);
    y += lines.length * 14 + 6;
  };

  const addBullet = (text: string) => {
    if (y > pageHeight - 60) { doc.addPage(); y = margin; }
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10.5);
    doc.setTextColor(70, 70, 70);
    const lines = doc.splitTextToSize(text, pageWidth - margin * 2 - 15);
    doc.circle(margin + 4, y - 3, 1.5, "F");
    doc.text(lines, margin + 15, y);
    y += lines.length * 14 + 4;
  };

  const addDivider = () => {
    y += 8;
    doc.setDrawColor(220, 220, 220);
    doc.line(margin, y, pageWidth - margin, y);
    y += 16;
  };

  // ── COVER ────────────────────────────────────────
  doc.setFillColor(99, 102, 241); // primary color
  doc.rect(0, 0, pageWidth, 140, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(28);
  doc.setTextColor(255, 255, 255);
  doc.text("NIMT Consultant Guide", margin, 80);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(13);
  doc.text("Your complete handbook to using the consultant portal", margin, 105);

  y = 180;

  addParagraph(
    "Welcome to NIMT Educational Institutions! This guide walks you through everything you need to know as a consultant — from adding your first lead to tracking commissions and staying in touch with our admission team."
  );

  addDivider();

  // ── 1. GETTING STARTED ─────────────────────────
  addHeading("1. Getting Started", 16);
  addParagraph("Log in to your consultant portal at https://uni.nimt.ac.in using the credentials shared by the NIMT admission team.");
  addBullet("Your login email is your registered consultant email.");
  addBullet("If you forgot your password, click 'Forgot Password' on the login screen.");
  addBullet("For any account issues, contact admissions@nimt.ac.in or your assigned NIMT representative.");

  addDivider();

  // ── 2. DASHBOARD ───────────────────────────────
  addHeading("2. Your Dashboard", 16);
  addParagraph("Your dashboard gives you a quick overview of your performance:");
  addBullet("Total Leads — number of students you've added.");
  addBullet("Pipeline — leads currently in progress (not yet admitted/rejected).");
  addBullet("Conversions — leads who have been admitted.");
  addBullet("Fee Collected — total fees paid by your admitted students.");
  addBullet("Commission Earned — your total earnings from successful conversions.");
  addBullet("Pending Payout — commission amount yet to be paid out to you.");

  addDivider();

  // ── 3. ADDING LEADS ────────────────────────────
  addHeading("3. Adding a New Lead", 16);
  addParagraph("Click the 'Add Lead' button at the top right of your dashboard. You'll need to provide:");
  addBullet("Student name and 10-digit phone number (mandatory).");
  addBullet("Email address (optional but recommended).");
  addBullet("Course of interest — pick from the dropdown.");
  addBullet("Campus — auto-filtered based on the course you choose.");
  addParagraph("Once submitted, the lead enters your pipeline and our admission team is notified.");

  addDivider();

  // ── 4. PIPELINE STAGES ─────────────────────────
  addHeading("4. Understanding Lead Stages", 16);
  addParagraph("Each lead moves through these stages:");
  addBullet("New Lead → Just registered, awaiting first contact.");
  addBullet("Application In Progress → Student has started filling the application form.");
  addBullet("Application Submitted → Form complete, under review.");
  addBullet("In Follow Up → Our team has spoken to the student.");
  addBullet("Visit Scheduled → Campus visit arranged.");
  addBullet("Interview → Student attending interview.");
  addBullet("Offer Sent → Admission offer issued.");
  addBullet("Token Paid → Student has paid the token amount.");
  addBullet("Admitted → Final admission confirmed. Commission becomes payable.");

  addDivider();

  // ── 5. COURSES & FEES ─────────────────────────
  addHeading("5. Courses & Fees", 16);
  addParagraph("Click 'Courses & Fees' in the sidebar to view detailed fee structures for every program offered by NIMT Educational Institutions:");
  addBullet("School courses (Beacon Avantika II, Beacon Arthala, Mirai) show student-type-based filters: Day Scholar, Day Boarder, Boarder.");
  addBullet("Boarding fees show three options: Non-AC, AC C Block, AC B Block.");
  addBullet("Transport fees show three zones based on distance.");
  addBullet("College courses show year-wise breakdowns with installment options and early-bird discounts.");

  addDivider();

  // ── 6. COMMISSIONS ────────────────────────────
  addHeading("6. Commissions & Payouts", 16);
  addParagraph("Your commission structure is based on your consultant agreement with NIMT. Commissions are paid according to the percentage of student fees collected.");
  addBullet("Commission becomes payable once the student is admitted and starts paying fees.");
  addBullet("Payout amount is proportional to the fee paid by the student so far.");
  addBullet("Track all payouts in the 'Commissions' tab of your dashboard.");
  addBullet("Status: Pending → Approved → Paid.");

  addDivider();

  // ── 7. VOICE MESSAGES ─────────────────────────
  addHeading("7. Sending Voice Messages", 16);
  addParagraph("Need to ask a question or share information quickly? Use the voice message feature:");
  addBullet("Click the microphone icon on your dashboard.");
  addBullet("Allow microphone access in your browser when prompted.");
  addBullet("Click 'Start Recording' and speak clearly.");
  addBullet("Click 'Stop' when done — you can play it back before sending.");
  addBullet("Add an optional subject line and click 'Send to Admission Team'.");
  addParagraph("The NIMT super admin and principal will receive an instant notification and respond as soon as possible.");

  addDivider();

  // ── 8. SUPPORT ────────────────────────────────
  addHeading("8. Need Help?", 16);
  addParagraph("If you have any questions or face issues, please contact:");
  addBullet("Email: admissions@nimt.ac.in");
  addBullet("Phone: Contact your assigned NIMT representative");
  addBullet("Voice message: Use the in-app voice message feature for the fastest response");

  addDivider();

  // ── FOOTER ────────────────────────────────────
  addParagraph("Thank you for being part of the NIMT Educational Institutions family. We look forward to a successful partnership!");

  doc.setFont("helvetica", "italic");
  doc.setFontSize(9);
  doc.setTextColor(150, 150, 150);
  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.text(
      `NIMT Consultant Guide  ·  Page ${i} of ${totalPages}  ·  uni.nimt.ac.in`,
      margin,
      pageHeight - 25
    );
  }

  doc.save("NIMT-Consultant-Guide.pdf");
}
