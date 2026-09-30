import { AboutMe } from "@/components/about-me";

export default async function AboutMePage({ searchParams }: PageProps<"/app/about-me">) {
  const { goal } = await searchParams;
  return <AboutMe initialGoalId={typeof goal === "string" ? goal : null} />;
}
