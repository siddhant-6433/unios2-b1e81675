import { CalendarDays, IndianRupee, MapPin, Receipt, Users } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { HolidayCalendarPanel } from "@/components/hr/HolidayCalendarPanel";
import { LocationsPanel } from "@/components/hr/LocationsPanel";
import { StatutoryConfigPanel } from "@/components/hr/StatutoryConfigPanel";
import { ExpenseCategoriesPanel } from "@/components/hr/ExpenseCategoriesPanel";
import { LeavePlansPanel } from "@/components/hr/LeavePlansPanel";

const HrSettings = () => {
  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-foreground">HR Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Holidays, locations, statutory rates, leave plans and expense categories — the
          configuration the rest of HR reads.
        </p>
      </div>

      <Tabs defaultValue="holidays">
        <TabsList className="flex-wrap h-auto justify-start gap-1 bg-muted/60 p-1">
          <TabsTrigger value="holidays" className="gap-1.5">
            <CalendarDays className="h-3.5 w-3.5" /> Holidays
          </TabsTrigger>
          <TabsTrigger value="locations" className="gap-1.5">
            <MapPin className="h-3.5 w-3.5" /> Locations
          </TabsTrigger>
          <TabsTrigger value="statutory" className="gap-1.5">
            <IndianRupee className="h-3.5 w-3.5" /> Statutory
          </TabsTrigger>
          <TabsTrigger value="leave" className="gap-1.5">
            <Users className="h-3.5 w-3.5" /> Leave
          </TabsTrigger>
          <TabsTrigger value="expenses" className="gap-1.5">
            <Receipt className="h-3.5 w-3.5" /> Expense categories
          </TabsTrigger>
        </TabsList>

        <TabsContent value="holidays" className="mt-6">
          <HolidayCalendarPanel />
        </TabsContent>
        <TabsContent value="locations" className="mt-6">
          <LocationsPanel />
        </TabsContent>
        <TabsContent value="statutory" className="mt-6">
          <StatutoryConfigPanel />
        </TabsContent>
        <TabsContent value="leave" className="mt-6">
          <LeavePlansPanel />
        </TabsContent>
        <TabsContent value="expenses" className="mt-6">
          <ExpenseCategoriesPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default HrSettings;
