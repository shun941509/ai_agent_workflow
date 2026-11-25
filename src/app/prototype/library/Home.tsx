import { BookOpen, Layers3, MousePointer2, SignalLow } from "lucide-react";
import LibraryGraph from "./LibraryGraph";
import { nodes, type NodeId, type Positions } from "./graph-model";
import { readLoanRule } from "./library-rule";
import LibraryArtwork from "../../../ui/home/LibraryArtwork";
import { librarySteps } from "../../../ui/home/LibrarySteps";
import HomeLayout, { libraryTitle, libraryDescription, libraryPracticeNote } from "../../../ui/home/HomeLayout";

function CanvasPreview({ positions, selected, hasSaved }: { positions: Positions; selected: NodeId; hasSaved: boolean }) {
  return (
    <figure className="lh-saved-canvas">
      <figcaption>
        <span><Layers3 aria-hidden="true" size={16} />{hasSaved ? "마지막 블록 배치" : "기본 블록 배치"}</span>
        {hasSaved && <span><MousePointer2 aria-hidden="true" size={14} />선택한 블록 <strong>{nodes[selected].name}</strong></span>}
      </figcaption>
      <LibraryGraph positions={positions} selected={selected} />
    </figure>
  );
}

type HomeProps = {
  onOpen: () => void;
  returning: boolean;
  hasSaved: boolean;
  rule: string;
  positions: Positions;
  selected: NodeId;
};

export default function Home({ onOpen, returning, hasSaved, rule, positions, selected }: HomeProps) {
  const resume = returning && hasSaved;
  const { limit } = readLoanRule(rule);
  return <HomeLayout resume={resume} onOpen={onOpen}
    title={libraryTitle} description={libraryDescription} steps={librarySteps} practiceNote={libraryPracticeNote}
    facts={<>
      <span><SignalLow aria-hidden="true" size={18} />초급</span>
      <span><BookOpen aria-hidden="true" size={15}/>{resume ? (limit === null ? "대출 한도 확인 필요" : "현재 대출 한도 " + limit + "권") : "도서관 안내"}</span>
    </>}
    artwork={returning ? <CanvasPreview positions={positions} selected={selected} hasSaved={hasSaved} /> : <LibraryArtwork />}
  />;
}
