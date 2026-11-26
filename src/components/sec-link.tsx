import { filingIndexUrl } from "@/lib/sec/links";

export function SecLink({ issuerCik, accession }: { issuerCik: string; accession: string }) {
  return (
    <a
      href={filingIndexUrl(issuerCik, accession)}
      target="_blank"
      rel="noreferrer"
      className="text-sky-400 hover:underline"
    >
      SEC
    </a>
  );
}
