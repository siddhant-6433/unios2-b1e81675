import { FeeCollectionVsDueReport } from "@/components/finance/FeeCollectionVsDueReport";
import { CandidateDocumentPendencyReport } from "@/components/reports/CandidateDocumentPendencyReport";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const Reports = () => {
  return (
    <div className="container mx-auto p-6 space-y-6 animate-fade-in">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Reports & Analytics</h1>
        <p className="text-sm text-muted-foreground">
          Real-time fee, document upload, and candidate pendency reports.
        </p>
      </div>
      <Tabs defaultValue="fee-collection" className="space-y-4">
        <TabsList>
          <TabsTrigger value="fee-collection">Fee Collection</TabsTrigger>
          <TabsTrigger value="document-pendency">Document Pendency</TabsTrigger>
        </TabsList>
        <TabsContent value="fee-collection">
          <FeeCollectionVsDueReport />
        </TabsContent>
        <TabsContent value="document-pendency">
          <CandidateDocumentPendencyReport />
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default Reports;
