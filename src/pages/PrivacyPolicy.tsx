import { GraduationCap } from "lucide-react";
import { Link } from "react-router-dom";

export default function PrivacyPolicy() {
  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto px-6 py-12">
        <div className="flex items-center gap-2.5 mb-10">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary">
            <GraduationCap className="h-5 w-5 text-primary-foreground" />
          </div>
          <span className="text-lg font-bold text-foreground">NIMT UniOs</span>
        </div>

        <h1 className="text-2xl font-bold text-foreground mb-2">Privacy Policy</h1>
        <p className="text-sm text-muted-foreground mb-8">Last updated: March 2026</p>

        <div className="prose prose-sm max-w-none space-y-6 text-sm text-foreground leading-relaxed">
          <section>
            <h2 className="text-base font-semibold mb-2">1. Information We Collect</h2>
            <p className="text-muted-foreground">We collect information you provide directly, including your name, phone number, email address, date of birth, academic records, and identity documents when you submit an application or register on our platform.</p>
          </section>

          <section>
            <h2 className="text-base font-semibold mb-2">2. How We Use Your Information</h2>
            <p className="text-muted-foreground">Your information is used to process admission applications, communicate with you regarding your application status, manage student records, and comply with regulatory requirements of educational institutions under NIMT.</p>
          </section>

          <section>
            <h2 className="text-base font-semibold mb-2">3. Data Sharing</h2>
            <p className="text-muted-foreground">We do not sell your personal data. Information may be shared with NIMT-affiliated institutions for admission processing and with regulatory bodies as required by law.</p>
          </section>

          <section>
            <h2 className="text-base font-semibold mb-2">4. Data Security</h2>
            <p className="text-muted-foreground">We implement industry-standard security measures to protect your personal information. All data is stored securely and access is restricted to authorised personnel only.</p>
          </section>

          <section>
            <h2 className="text-base font-semibold mb-2">5. Your Rights</h2>
            <p className="text-muted-foreground">You have the right to access, correct, or request deletion of your personal data. To exercise these rights, contact us at <a href="mailto:info@nimt.ac.in" className="text-primary underline">info@nimt.ac.in</a>.</p>
          </section>

          <section>
            <h2 className="text-base font-semibold mb-2">6. Contact</h2>
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
