import { SiteNav } from "@/components/SiteNav";
import { HeroSection } from "@/components/HeroSection";
import { SectionDivider } from "@/components/SectionDivider";
import { HowItWorks } from "@/components/HowItWorks";
import { FeaturesSection } from "@/components/FeaturesSection";
import { IntegrationSection } from "@/components/IntegrationSection";
import { ArchitectureSection } from "@/components/ArchitectureSection";
import { PricingSection } from "@/components/PricingSection";
import { FaqSection } from "@/components/FaqSection";
import { CtaSection } from "@/components/CtaSection";
import { SiteFooter } from "@/components/SiteFooter";
import { Reveal } from "@/components/Reveal";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col bg-page">
      <SiteNav />
      <HeroSection />
      <SectionDivider />
      <Reveal>
        <HowItWorks />
      </Reveal>
      <SectionDivider />
      <Reveal>
        <FeaturesSection />
      </Reveal>
      <SectionDivider />
      <Reveal>
        <IntegrationSection />
      </Reveal>
      <SectionDivider />
      <Reveal>
        <ArchitectureSection />
      </Reveal>
      <SectionDivider />
      <Reveal>
        <PricingSection />
      </Reveal>
      <SectionDivider />
      <Reveal>
        <FaqSection />
      </Reveal>
      <Reveal>
        <CtaSection />
      </Reveal>
      <SiteFooter />
    </main>
  );
}
