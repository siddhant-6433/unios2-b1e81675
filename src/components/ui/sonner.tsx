import { useTheme } from "next-themes";
import { Toaster as Sonner, toast } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:elevation-mid group-[.toaster]:rounded-lg",
          description: "group-[.toast]:text-muted-foreground",
          actionButton: "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground group-[.toast]:transition-all group-[.toast]:duration-160 group-[.toast]:ease-standard",
          cancelButton: "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
          success: "group-[.toaster]:!border-success/30 group-[.toaster]:!bg-success/5 group-[.toaster]:!text-success-foreground",
          error: "group-[.toaster]:!border-destructive/30 group-[.toaster]:!bg-destructive/5 group-[.toaster]:!text-destructive",
          warning: "group-[.toaster]:!border-warning/30 group-[.toaster]:!bg-warning/5 group-[.toaster]:!text-warning-foreground",
          info: "group-[.toaster]:!border-info/30 group-[.toaster]:!bg-info/5 group-[.toaster]:!text-info-foreground",
        },
      }}
      {...props}
    />
  );
};

export { Toaster, toast };
