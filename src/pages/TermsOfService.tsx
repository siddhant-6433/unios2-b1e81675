import { GraduationCap } from "lucide-react";
import { Link } from "react-router-dom";

export default function TermsOfService() {
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

        <h1 className="text-2xl font-bold text-foreground mb-2">Terms &amp; Conditions</h1>
        <p className="text-sm text-muted-foreground mb-8">Last updated: April 4, 2026</p>

        <div className="space-y-8 text-sm text-foreground leading-relaxed">

          {/* 1 */}
          <section>
            <h2 className="text-base font-semibold mb-3">1. Acceptance of Terms</h2>
            <p className="text-muted-foreground">
              By accessing or using NIMT UniOs ("the Platform"), you agree to be bound by these Terms
              &amp; Conditions and our{" "}
              <Link to="/privacy" className="text-primary underline">Privacy Policy</Link>. If you do
              not agree to these terms, please do not use the Platform.
            </p>
          </section>

          {/* 2 */}
          <section>
            <h2 className="text-base font-semibold mb-3">2. About the Platform</h2>
            <p className="text-muted-foreground">
              NIMT UniOs is an education management platform operated by NIMT Group of Institutions for
              applicants, students, parents, staff, and administrators affiliated with NIMT-associated
              campuses. The Platform facilitates admissions, fee payments, academic records, attendance,
              and related institutional processes.
            </p>
          </section>

          {/* 3 */}
          <section>
            <h2 className="text-base font-semibold mb-3">3. Eligibility &amp; Account Responsibility</h2>
            <ul className="list-disc list-outside ml-4 space-y-1.5 text-muted-foreground">
              <li>You must be at least 16 years of age, or have verifiable parental/guardian consent, to use the Platform.</li>
              <li>You are responsible for maintaining the confidentiality of your account credentials and for all activities under your account.</li>
              <li>Notify us immediately at <a href="mailto:info@nimt.ac.in" className="text-primary underline">info@nimt.ac.in</a> if you suspect unauthorised access to your account.</li>
              <li>NIMT reserves the right to suspend or terminate accounts that violate these terms.</li>
            </ul>
          </section>

          {/* 4 */}
          <section>
            <h2 className="text-base font-semibold mb-3">4. Accuracy of Information</h2>
            <p className="text-muted-foreground">
              You agree to provide accurate, current, and complete information when submitting
              applications or registering on the Platform. Providing false or misleading information
              may result in rejection of your application, cancellation of admission, or permanent
              suspension of access — without any refund of fees paid.
            </p>
          </section>

          {/* 5 */}
          <section>
            <h2 className="text-base font-semibold mb-3">5. Fee Payments</h2>
            <p className="text-muted-foreground mb-3">
              All fees quoted on the Platform are in Indian Rupees (INR) and inclusive of applicable
              taxes unless stated otherwise. Payments are processed through secure third-party payment
              gateways. NIMT does not store your card or UPI credentials.
            </p>
            <p className="text-muted-foreground">
              Fee schedules, due dates, and late payment charges are communicated separately via the
              Platform and official correspondence. Non-payment of dues by the stated deadline may
              result in withholding of academic records, results, or access to the Platform.
            </p>
          </section>

          {/* 6 */}
          <section>
            <h2 className="text-base font-semibold mb-3">6. Refund Policy</h2>

            <p className="text-muted-foreground mb-4">
              NIMT's refund policy is aligned with the guidelines issued by the University Grants
              Commission (UGC) and affiliated universities. All refund requests must be submitted in
              writing to the admissions office or via email to{" "}
              <a href="mailto:admissions@nimt.ac.in" className="text-primary underline">admissions@nimt.ac.in</a>.
            </p>

            <h3 className="text-sm font-semibold mb-2 text-foreground/80">a. Application Fee</h3>
            <p className="text-muted-foreground mb-4">
              The application/registration fee is <strong>non-refundable</strong> under all
              circumstances, including withdrawal before or after the offer letter is issued.
            </p>

            <h3 className="text-sm font-semibold mb-2 text-foreground/80">b. Token / Pre-Admission Fee</h3>
            <p className="text-muted-foreground mb-2">
              The token (pre-admission) fee is charged to secure your seat. The following schedule applies:
            </p>
            <div className="overflow-x-auto rounded-lg border border-border mb-4">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-muted/60 text-left">
                    <th className="px-3 py-2 font-semibold">Withdrawal Timeline</th>
                    <th className="px-3 py-2 font-semibold">Refund</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border text-muted-foreground">
                  <tr>
                    <td className="px-3 py-2">Before the offer letter is issued</td>
                    <td className="px-3 py-2 text-success font-medium">Full refund</td>
                  </tr>
                  <tr>
                    <td className="px-3 py-2">Within 15 days of paying the token fee</td>
                    <td className="px-3 py-2 text-success font-medium">Full refund (less ₹1,000 processing charge)</td>
                  </tr>
                  <tr>
                    <td className="px-3 py-2">15–30 days after paying the token fee</td>
                    <td className="px-3 py-2 text-warning-foreground font-medium">50% refund</td>
                  </tr>
                  <tr>
                    <td className="px-3 py-2">More than 30 days after paying the token fee</td>
                    <td className="px-3 py-2 text-destructive font-medium">No refund</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <h3 className="text-sm font-semibold mb-2 text-foreground/80">c. Tuition &amp; Programme Fees</h3>
            <p className="text-muted-foreground mb-2">
              In accordance with UGC guidelines (Circular dated 27 April 2018 and subsequent advisories),
              the following refund schedule applies for students who withdraw from a programme:
            </p>
            <div className="overflow-x-auto rounded-lg border border-border mb-4">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-muted/60 text-left">
                    <th className="px-3 py-2 font-semibold">Point of Withdrawal</th>
                    <th className="px-3 py-2 font-semibold">Refund of Fees Paid</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border text-muted-foreground">
                  <tr>
                    <td className="px-3 py-2">15 or more days before the formally notified last date of admission</td>
                    <td className="px-3 py-2 text-success font-medium">Full refund (less ₹1,000 processing charge)</td>
                  </tr>
                  <tr>
                    <td className="px-3 py-2">Less than 15 days before the last date of admission</td>
                    <td className="px-3 py-2 text-warning-foreground font-medium">90% refund</td>
                  </tr>
                  <tr>
                    <td className="px-3 py-2">After admission but within 30 days of commencement of classes</td>
                    <td className="px-3 py-2 text-warning-foreground font-medium">80% refund</td>
                  </tr>
                  <tr>
                    <td className="px-3 py-2">More than 30 days after commencement of classes</td>
                    <td className="px-3 py-2 text-destructive font-medium">No refund</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <h3 className="text-sm font-semibold mb-2 text-foreground/80">d. Failed / Duplicate Payments</h3>
            <p className="text-muted-foreground mb-4">
              If a payment is debited from your account but not reflected in the Portal, or if you are
              charged twice for the same transaction, please email{" "}
              <a href="mailto:accounts@nimt.ac.in" className="text-primary underline">accounts@nimt.ac.in</a>{" "}
              with your transaction reference number. Such amounts are refunded to the original payment
              method within <strong>7–10 business days</strong> of verification.
            </p>

            <h3 className="text-sm font-semibold mb-2 text-foreground/80">e. Refund Processing Timeline</h3>
            <p className="text-muted-foreground mb-2">
              Approved refunds are processed as follows:
            </p>
            <ul className="list-disc list-outside ml-4 space-y-1 text-muted-foreground">
              <li>Online payments (UPI / card / net banking): 7–10 business days to the original account.</li>
              <li>Demand draft / cash payments: 15–20 business days via account transfer (NEFT/RTGS).</li>
            </ul>
            <p className="text-muted-foreground mt-3">
              NIMT is not responsible for delays caused by your bank after the refund has been initiated.
            </p>

            <h3 className="text-sm font-semibold mt-4 mb-2 text-foreground/80">f. Non-Refundable Items</h3>
            <p className="text-muted-foreground mb-1">The following are non-refundable in all cases:</p>
            <ul className="list-disc list-outside ml-4 space-y-1 text-muted-foreground">
              <li>Application / registration fee</li>
              <li>Examination and re-examination fees</li>
              <li>Library security deposit (returned at graduation, less any dues)</li>
              <li>Fees for consumable materials, study kits, or uniforms once issued</li>
            </ul>
          </section>

          {/* 7 */}
          <section>
            <h2 className="text-base font-semibold mb-3">7. Intellectual Property</h2>
            <p className="text-muted-foreground">
              All content, trademarks, logos, course material, and software on NIMT UniOs are the
              property of NIMT Group of Institutions or its licensors. You may not reproduce, distribute,
              modify, or create derivative works from any content without prior written permission from
              NIMT.
            </p>
          </section>

          {/* 8 */}
          <section>
            <h2 className="text-base font-semibold mb-3">8. Acceptable Use</h2>
            <p className="text-muted-foreground mb-2">You agree not to:</p>
            <ul className="list-disc list-outside ml-4 space-y-1.5 text-muted-foreground">
              <li>Use the Platform for any unlawful purpose or in violation of any applicable law.</li>
              <li>Attempt to gain unauthorised access to any part of the Platform or its underlying systems.</li>
              <li>Upload or transmit viruses, malware, or any other malicious code.</li>
              <li>Impersonate any person or entity, or misrepresent your affiliation with NIMT.</li>
              <li>Scrape, crawl, or harvest data from the Platform without prior written consent.</li>
            </ul>
          </section>

          {/* 9 */}
          <section>
            <h2 className="text-base font-semibold mb-3">9. Limitation of Liability</h2>
            <p className="text-muted-foreground">
              NIMT UniOs is provided on an "as is" and "as available" basis. We do not warrant
              uninterrupted or error-free operation of the Platform. To the fullest extent permitted by
              applicable law, NIMT shall not be liable for any indirect, incidental, special, or
              consequential damages arising from your use of, or inability to use, the Platform —
              including but not limited to loss of data, loss of revenue, or interruption to academic
              activities.
            </p>
          </section>

          {/* 10 */}
          <section>
            <h2 className="text-base font-semibold mb-3">10. Governing Law &amp; Disputes</h2>
            <p className="text-muted-foreground">
              These Terms are governed by the laws of India. Any dispute arising out of or in connection
              with these Terms shall be subject to the exclusive jurisdiction of the courts in Greater
              Noida, Uttar Pradesh, India. We encourage you to first contact us at{" "}
              <a href="mailto:info@nimt.ac.in" className="text-primary underline">info@nimt.ac.in</a>{" "}
              to resolve any concern amicably before initiating legal proceedings.
            </p>
          </section>

          {/* 11 */}
          <section>
            <h2 className="text-base font-semibold mb-3">11. Changes to These Terms</h2>
            <p className="text-muted-foreground">
              We reserve the right to modify these Terms at any time. Changes will be posted on this page
              with an updated date. Continued use of the Platform after changes are posted constitutes
              your acceptance of the revised Terms.
            </p>
          </section>

          {/* 12 */}
          <section>
            <h2 className="text-base font-semibold mb-3">12. Contact</h2>
            <p className="text-muted-foreground">
              NIMT Group of Institutions<br />
              Plot No. 7, Knowledge Park-I<br />
              Greater Noida, Uttar Pradesh 201310<br />
              <a href="mailto:info@nimt.ac.in" className="text-primary underline">info@nimt.ac.in</a><br />
              +91-9555-192-192
            </p>
          </section>
        </div>

        <div className="mt-10 pt-6 border-t border-border flex flex-wrap gap-4 items-center text-sm">
          <Link to="/login" className="text-primary hover:underline">← Back to Login</Link>
          <span className="text-muted-foreground">·</span>
          <Link to="/privacy" className="text-primary hover:underline">Privacy Policy</Link>
        </div>
      </div>
    </div>
  );
}
