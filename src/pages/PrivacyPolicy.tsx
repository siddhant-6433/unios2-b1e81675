import { GraduationCap } from "lucide-react";
import { Link } from "react-router-dom";

export default function PrivacyPolicy() {
  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto px-6 py-12">

        {/* Logo */}
        <div className="flex items-center gap-2.5 mb-10">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary">
            <GraduationCap className="h-5 w-5 text-primary-foreground" />
          </div>
          <span className="text-lg font-bold text-foreground">NIMT UniOs</span>
        </div>

        <h1 className="text-2xl font-bold text-foreground mb-2">Privacy Policy</h1>
        <p className="text-sm text-muted-foreground mb-8">Last updated: April 4, 2026</p>

        <div className="space-y-8 text-sm text-foreground leading-relaxed">

          {/* Introduction */}
          <section>
            <p className="text-muted-foreground">
              NIMT Group of Institutions ("NIMT", "we", "us", or "our") is committed to protecting your
              privacy. This policy explains how we collect, use, and safeguard personal information across
              our website <strong>nimt.ac.in</strong>, the student platform <strong>UniOs</strong>, and
              other digital channels operated by NIMT. By using our services, you agree to the terms of
              this policy.
            </p>
          </section>

          {/* 1 */}
          <section>
            <h2 className="text-base font-semibold mb-3">1. Information We Collect</h2>

            <h3 className="text-sm font-semibold mb-1.5 text-foreground/80">a. Personal Information You Provide</h3>
            <p className="text-muted-foreground mb-3">
              During admissions we collect your full name, date of birth, gender, email address, phone
              number, postal address, parent/guardian details, educational qualifications, and category
              information.
            </p>
            <p className="text-muted-foreground mb-3">
              Upon enrolment we may collect your Aadhaar number (as permitted under applicable law),
              passport-size photographs, mark sheets, identity documents, and bank account details for
              fee processing.
            </p>
            <p className="text-muted-foreground">
              Contact and enquiry forms capture your name, email, phone number, and message. Event
              registration collects name, institutional affiliation, contact details, and preferences.
            </p>

            <h3 className="text-sm font-semibold mt-4 mb-1.5 text-foreground/80">b. Information Collected Automatically</h3>
            <p className="text-muted-foreground mb-2">
              We automatically collect device and browser data (IP address, browser type and version,
              operating system, device type, and screen resolution) and usage data (pages visited, time
              spent, referral URLs, click patterns, and navigation paths).
            </p>
            <p className="text-muted-foreground">
              We use cookies, pixels, and local storage to enhance your experience, remember preferences,
              and analyse website traffic. See Section 6 for details.
            </p>

            <h3 className="text-sm font-semibold mt-4 mb-1.5 text-foreground/80">c. Information from Third Parties</h3>
            <p className="text-muted-foreground">
              Academic records may come from universities and examination boards. Payment confirmations
              arrive from payment gateways (we do not store full card details). We may also receive data
              from TCS iON and other academic alliance partners for certification and placement purposes.
            </p>
          </section>

          {/* 2 */}
          <section>
            <h2 className="text-base font-semibold mb-3">2. How We Use Your Information</h2>
            <ul className="list-disc list-outside ml-4 space-y-1.5 text-muted-foreground">
              <li>Processing admissions, enrolment, and student lifecycle management through UniOs.</li>
              <li>Communicating with you about courses, events, results, fee reminders, and institutional updates.</li>
              <li>Supporting placement activities with recruiting partners (with your consent).</li>
              <li>Improving our website and platforms through analytics.</li>
              <li>Complying with regulatory and accreditation requirements.</li>
              <li>Responding to enquiries and providing customer support.</li>
              <li>Fraud prevention and platform security.</li>
            </ul>
          </section>

          {/* 3 */}
          <section>
            <h2 className="text-base font-semibold mb-3">3. How We Share Your Information</h2>
            <p className="text-muted-foreground mb-3">
              We do not sell your personal information. Data may be shared in the following circumstances:
            </p>
            <ul className="list-disc list-outside ml-4 space-y-1.5 text-muted-foreground">
              <li>
                <strong>Affiliated Universities & Regulatory Bodies</strong> — for degree conferral and
                examinations (including AKTU, CCSU, University of Rajasthan, ABVMUP Lucknow).
              </li>
              <li>
                <strong>Academic Alliance Partners</strong> — TCS iON, Make, and Anthropic, strictly
                for educational services, certifications, and platform operations.
              </li>
              <li>
                <strong>Recruiting Companies</strong> — student profiles for placement support, with
                prior consent.
              </li>
              <li>
                <strong>Service Providers</strong> — hosting providers, payment gateways, email
                services, and analytics platforms, under confidentiality agreements.
              </li>
              <li>
                <strong>Legal Authorities</strong> — when required by law, court order, or government
                regulation.
              </li>
            </ul>
          </section>

          {/* 4 */}
          <section>
            <h2 className="text-base font-semibold mb-3">4. Data Security</h2>
            <ul className="list-disc list-outside ml-4 space-y-1.5 text-muted-foreground">
              <li>Encryption of data in transit (TLS/SSL) and at rest.</li>
              <li>Role-based access controls within UniOs and internal systems.</li>
              <li>Regular security assessments and vulnerability testing.</li>
              <li>Secure cloud infrastructure with data residency in India.</li>
            </ul>
            <p className="text-muted-foreground mt-3">
              While we strive to protect your data, no method of electronic storage or transmission is
              100% secure. We encourage you to keep your account credentials confidential.
            </p>
          </section>

          {/* 5 */}
          <section>
            <h2 className="text-base font-semibold mb-3">5. Data Retention</h2>
            <div className="space-y-2 text-muted-foreground">
              <p><strong className="text-foreground">Student Records:</strong> Retained permanently as part of institutional academic records, as required by UGC and affiliated university regulations.</p>
              <p><strong className="text-foreground">Enquiry & Application Data:</strong> Retained for up to 3 years from submission if you do not enrol.</p>
              <p><strong className="text-foreground">Website Analytics Data:</strong> Aggregated and anonymised data may be retained indefinitely.</p>
              <p><strong className="text-foreground">Payment Records:</strong> Retained for 8 years as required under Indian tax and financial regulations.</p>
            </div>
          </section>

          {/* 6 */}
          <section>
            <h2 className="text-base font-semibold mb-3">6. Cookies & Tracking Technologies</h2>
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-muted/60 text-left">
                    <th className="px-3 py-2 font-semibold">Type</th>
                    <th className="px-3 py-2 font-semibold">Purpose</th>
                    <th className="px-3 py-2 font-semibold">Duration</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border text-muted-foreground">
                  <tr>
                    <td className="px-3 py-2 font-medium text-foreground">Essential</td>
                    <td className="px-3 py-2">Required for basic site functionality (session management, security)</td>
                    <td className="px-3 py-2">Session</td>
                  </tr>
                  <tr>
                    <td className="px-3 py-2 font-medium text-foreground">Analytics</td>
                    <td className="px-3 py-2">Help us understand how visitors use our website (Google Analytics, Plausible)</td>
                    <td className="px-3 py-2">Up to 2 years</td>
                  </tr>
                  <tr>
                    <td className="px-3 py-2 font-medium text-foreground">Functional</td>
                    <td className="px-3 py-2">Remember your preferences (language, campus selection)</td>
                    <td className="px-3 py-2">1 year</td>
                  </tr>
                  <tr>
                    <td className="px-3 py-2 font-medium text-foreground">Marketing</td>
                    <td className="px-3 py-2">Deliver relevant advertisements and track campaign performance</td>
                    <td className="px-3 py-2">Up to 1 year</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="text-muted-foreground mt-3">
              You can manage cookie preferences through your browser settings. Disabling certain cookies
              may affect platform functionality.
            </p>
          </section>

          {/* 7 */}
          <section>
            <h2 className="text-base font-semibold mb-3">7. Your Rights</h2>
            <p className="text-muted-foreground mb-3">
              Under the Digital Personal Data Protection Act, 2023, you have the following rights:
            </p>
            <ul className="list-disc list-outside ml-4 space-y-1.5 text-muted-foreground">
              <li><strong className="text-foreground">Access:</strong> Request a copy of the personal data we hold about you.</li>
              <li><strong className="text-foreground">Correction:</strong> Request correction of inaccurate or incomplete data.</li>
              <li><strong className="text-foreground">Erasure:</strong> Request deletion of your data, subject to legal and regulatory retention requirements.</li>
              <li><strong className="text-foreground">Withdraw Consent:</strong> Withdraw consent for data processing at any time (this does not affect the lawfulness of prior processing).</li>
              <li><strong className="text-foreground">Grievance Redressal:</strong> Lodge a complaint with our Data Protection Officer or the Data Protection Board of India.</li>
            </ul>
            <p className="text-muted-foreground mt-3">
              To exercise any of these rights, contact our Data Protection Officer at{" "}
              <a href="mailto:tech@nimt.ac.in" className="text-primary underline">tech@nimt.ac.in</a>.
            </p>
          </section>

          {/* 8 */}
          <section>
            <h2 className="text-base font-semibold mb-3">8. Children's Privacy</h2>
            <ul className="list-disc list-outside ml-4 space-y-1.5 text-muted-foreground">
              <li>For K–12 programmes, we collect information only with verifiable parental or guardian consent.</li>
              <li>Data collected from minors is used solely for educational and administrative purposes.</li>
              <li>Parents/guardians may request access to, correction of, or deletion of their child's data at any time.</li>
            </ul>
          </section>

          {/* 9 */}
          <section>
            <h2 className="text-base font-semibold mb-3">9. Third-Party Links</h2>
            <p className="text-muted-foreground">
              Our website and platform may contain links to external websites. We are not responsible for
              the privacy practices of those sites and encourage you to review their policies independently.
            </p>
          </section>

          {/* 10 */}
          <section>
            <h2 className="text-base font-semibold mb-3">10. Contact — Data Protection Officer</h2>
            <p className="text-muted-foreground">
              NIMT Group of Institutions<br />
              Plot No. 7, Knowledge Park-I<br />
              Greater Noida, Uttar Pradesh 201310<br />
              <a href="mailto:tech@nimt.ac.in" className="text-primary underline">tech@nimt.ac.in</a><br />
              +91-9555-192-192
            </p>
          </section>

          {/* 11 */}
          <section>
            <h2 className="text-base font-semibold mb-3">11. Changes to This Policy</h2>
            <p className="text-muted-foreground">
              We may update this Privacy Policy to reflect changes in our practices, technology, or legal
              requirements. The revised date will be updated at the top of this page. Continued use of our
              services after changes are posted constitutes your acceptance of the revised policy.
            </p>
          </section>
        </div>

        <div className="mt-10 pt-6 border-t border-border flex flex-wrap gap-4 items-center text-sm">
          <Link to="/login" className="text-primary hover:underline">← Back to Login</Link>
          <span className="text-muted-foreground">·</span>
          <Link to="/terms" className="text-primary hover:underline">Terms &amp; Conditions</Link>
        </div>
      </div>
    </div>
  );
}
