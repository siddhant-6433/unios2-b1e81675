import { FeeCollectionVsDueReport } from "@/components/finance/FeeCollectionVsDueReport";

const Reports = () => {
  return (
    <div className="container mx-auto p-6 space-y-6 animate-fade-in">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Reports & Analytics</h1>
        <p className="text-sm text-muted-foreground">
          Real-time month-wise fee collection, target dues, balances, and granular student trends.
        </p>
      </div>
      <FeeCollectionVsDueReport />
    </div>
  );
};

export default Reports;
