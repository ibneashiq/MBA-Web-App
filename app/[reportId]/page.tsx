import AsbestosReportForm from "../components/AsbestosReportForm";
import { getReportFromSheets } from "../utils/sheetsWriter";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ reportId: string }>;
}

export default async function ReportPage({ params }: PageProps) {
  const { reportId } = await params;

  const initialData = await getReportFromSheets(reportId);

  if (!initialData) {
    notFound();
  }

  return (
    <div className="min-h-screen bg-zinc-100 font-sans dark:bg-zinc-900">
      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
        <AsbestosReportForm initialData={initialData} reportId={reportId} />
      </main>
    </div>
  );
}
