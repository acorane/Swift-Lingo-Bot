import { useLocation } from "wouter";
import { useCreateJob, getListJobsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useTranslation } from "@/lib/i18n";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, ArrowLeft } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const LANGUAGES = [
  { value: "en", label: "English" },
  { value: "ru", label: "Russian" },
  { value: "uz", label: "Uzbek" },
  { value: "de", label: "German" },
  { value: "fr", label: "French" },
  { value: "es", label: "Spanish" },
  { value: "tr", label: "Turkish" },
  { value: "ar", label: "Arabic" },
  { value: "zh", label: "Chinese" },
  { value: "ja", label: "Japanese" },
];

const schema = z.object({
  title: z.string().min(5, "Title must be at least 5 characters"),
  description: z.string().min(20, "Please provide a detailed description"),
  sourceLang: z.string().min(1, "Select source language"),
  targetLang: z.string().min(1, "Select target language"),
  wordCount: z.coerce.number().int().positive().optional(),
  budgetMin: z.coerce.number().positive("Enter minimum budget"),
  budgetMax: z.coerce.number().positive("Enter maximum budget"),
  deliveryType: z.enum(["standard", "express", "urgent"]),
  specialization: z.string().optional(),
});

type FormData = z.infer<typeof schema>;

export default function PostJob() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { t } = useTranslation();
  const createJob = useCreateJob();

  const form = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      title: "",
      description: "",
      sourceLang: "",
      targetLang: "",
      budgetMin: undefined,
      budgetMax: undefined,
      deliveryType: "standard",
      specialization: "",
    },
  });

  const onSubmit = async (values: FormData) => {
    try {
      const job = await createJob.mutateAsync({ data: values as any });
      queryClient.invalidateQueries({ queryKey: getListJobsQueryKey({}) });
      toast({ title: t("post_job"), description: "Your job is now live and accepting bids." });
      setLocation(`/jobs/${job.id}`);
    } catch (err: any) {
      toast({ title: t("error"), description: err.message || "Failed to post job", variant: "destructive" });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => setLocation("/jobs")} data-testid="button-back">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h1 className="text-xl font-bold tracking-tight">{t("post_a_job")}</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("job_details")}</CardTitle>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField control={form.control} name="title" render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("job_title")}</FormLabel>
                  <FormControl>
                    <Input placeholder={t("job_title_placeholder")} {...field} data-testid="input-job-title" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="description" render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("description")}</FormLabel>
                  <FormControl>
                    <Textarea placeholder={t("description_placeholder")} rows={4} {...field} data-testid="input-job-description" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <div className="grid grid-cols-2 gap-3">
                <FormField control={form.control} name="sourceLang" render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("from_lang")}</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="select-source-lang">
                          <SelectValue placeholder={t("from_lang")} />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {LANGUAGES.map(l => <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />

                <FormField control={form.control} name="targetLang" render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("to_lang")}</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="select-target-lang">
                          <SelectValue placeholder={t("to_lang")} />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {LANGUAGES.map(l => <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>

              <FormField control={form.control} name="wordCount" render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("word_count")}</FormLabel>
                  <FormControl>
                    <Input type="number" placeholder="e.g. 1500" {...field} data-testid="input-word-count" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <div className="grid grid-cols-2 gap-3">
                <FormField control={form.control} name="budgetMin" render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("budget_min")}</FormLabel>
                    <FormControl>
                      <Input type="number" placeholder="50" {...field} data-testid="input-budget-min" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="budgetMax" render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("budget_max")}</FormLabel>
                    <FormControl>
                      <Input type="number" placeholder="200" {...field} data-testid="input-budget-max" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>

              <FormField control={form.control} name="deliveryType" render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("delivery_type")}</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger data-testid="select-delivery-type">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="standard">{t("standard")}</SelectItem>
                      <SelectItem value="express">{t("express")}</SelectItem>
                      <SelectItem value="urgent">{t("urgent")}</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="specialization" render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("specialization")}</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value ?? ""}>
                    <FormControl>
                      <SelectTrigger data-testid="select-specialization">
                        <SelectValue placeholder={t("any")} />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="any">{t("any")}</SelectItem>
                      <SelectItem value="legal">Legal</SelectItem>
                      <SelectItem value="medical">Medical</SelectItem>
                      <SelectItem value="technical">Technical</SelectItem>
                      <SelectItem value="financial">Financial</SelectItem>
                      <SelectItem value="marketing">Marketing</SelectItem>
                      <SelectItem value="literary">Literary</SelectItem>
                      <SelectItem value="general">General</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />

              <Button type="submit" className="w-full" disabled={createJob.isPending} data-testid="button-submit-job">
                {createJob.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                {t("post_job")}
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
