import { GraduationCap } from "lucide-react";
import { Link } from "react-router-dom";

export default function TermsOfService() {
  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto px-6 py-12">
        <div className="flex items-center gap-2.5 mb-10">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary">
            <GraduationCap className="h-5 w-5 text-primary-foreground" />
          </div>
          <span className="text-lg font-bold text-foreground">NIMT UniOs</span>
        </div>

        <h1 className="text-2xl font-bold text-foreground mb-2">Terms of Service</h1>
        <p className="text-sm text-muted-foreground mb-8">Last updated: March 2026</p>

        <div className="prose prose-sm max-w-none space-y-6 text-sm text-foreground leading-relaxed">
          <section>
            <h2 className="text-base font-semibold mb-2">1. Acceptance of Terms</h2>
            <p className="text-muted-foreground">By accessing or using NIMT UniOs, you agree to be bound by these Terms of Service. If you do not agree to these terms, please do not use the platform.</p>
          </section>

          <section>
            <h2 className="text-base font-semibold mb-2">2. Use of the Platform</h2>
            <p className="text-muted-foreground">NIMT UniOs is an education management platform for students, staff, and administrators affiliated with NIMT-associated institutions. You agree to use the platform only for lawful purposes and in accordance with these terms.</p>
          </section>

          <section>
            <h2 className="text-base font-semibold mb-2">3. Account Responsibility</h2>
            <p className="text-muted-foreground">You are responsible for maintaining the confidentiality of your account credentials and for all activities that occur under your account. Notify us immediately at <a href="mailto:info@nimt.ac.in" className="text-primary underline">info@nimt.ac.in</a> if you suspect unauthorised access.</p>
          </section>

          <section>
            <h2 className="text-base font-semibold mb-2">4. Accuracy of Information</h2>
            <p className="text-muted-foreground">You agree to provide accurate, current, and complete information when submitting applications or registering on the platform. Providing false information may result in rejection of your application or termination of access.</p>
          </section>

          <section>
            <h2 className="text-base font-semibold mb-2">5. Intellectual Property</h2>
            <p className="text-muted-foreground">All content, trademarks, and materials on NIMT UniOs are the property of NIMT Institute of Management & Technology or its affiliates. You may not reproduce or distribute any content without prior written permission.</p>
          </section>

          <section>
            <h2 className="text-base font-semibold mb-2">6. Limitation of Liability</h2>
            <p className="text-muted-foreground">NIMT UniOs is provided on an "as is" basis. We do not warrant uninterrupted or error-free operation of the platform. To the fullest extent permitted by law, NIMT shall not be liable for any indirect or consequential damages arising from your use of the platform.</p>
          </section>

          <section>
            <h2 className="text-base font-semibold mb-2">7. Changes to Terms</h2>
            <p className="text-muted-foreground">We reserve the right to modify these terms at any time. Continued use of the platform after changes are posted constitutes your acceptance of the revised terms.</p>
          </section>

          <section>
            <h2 className="text-base font-semibold mb-2">8. Contact</h2>
            <p className="text-muted-foreground">NIMT Institute of Management &amp; Technology<br />Greater Noida, Uttar Pradesh, India<br /><a href="mailto:info@nimt.ac.in" className="text-primary underline">info@nimt.ac.in</a></p>
          </section>
        </div>

        <div className="mt-10 pt-6 border-t border-border">
          <Link to="/login" className="text-sm text-primary hover:underline">← Back to Login</Link>
        </div>
      </div>
    </div>
  );
}
