import { Layers3 } from "lucide-react";

export default function LibraryArtwork() {
  return (
    <figure className="lh-blueprint">
      <figcaption><Layers3 aria-hidden="true" size={16} strokeWidth={1.6} />블록 연결도</figcaption>
      <svg className="lh-diagram" viewBox="0 0 524 285" role="img" aria-labelledby="lh-diagram-title lh-diagram-desc">
        <title id="lh-diagram-title">내 자료로 안내하기의 블록 연결도</title>
        <desc id="lh-diagram-desc">질문 입력, 도서관 안내 Agent, 대출 안내 파일 만들기, 답변 전달 순서로 실행합니다. 도서관 이용규정과 근거 인용 Skill은 Agent에 연결됩니다.</desc>
        <defs>
          <marker id="lh-order-arrow" markerWidth="6" markerHeight="6" refX="4.4" refY="3" orient="auto">
            <path d="m1 1 3.4 2L1 5" fill="none" stroke="#e3ebff" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
          </marker>
          <marker id="lh-ref-arrow" markerWidth="6" markerHeight="6" refX="4.4" refY="3" orient="auto">
            <path d="m1 1 3.4 2L1 5" fill="none" stroke="#b7caff" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
          </marker>
        </defs>
        <g stroke="#b1c5ff" strokeWidth=".7" strokeOpacity=".32" fill="none">
          <path d="m131 151 111 46 92-40M133 157l-6-3m111 42 6 3m85-41 6-2M148 141l-14 7m176-12 22 9M242 179v15" />
          <path d="m278 33 20-9m-12 111 35 15" strokeDasharray="3 4" />
        </g>
        <g className="lh-order-wire" markerEnd="url(#lh-order-arrow)">
          <path d="M112 122h43" />
          <path d="M298 130h17q6 0 6-6v-17q0-6 6-6h20" />
          <path d="M427 124v44" />
        </g>
        <g className="lh-ref-wire" markerEnd="url(#lh-ref-arrow)">
          <path d="M94 226v-12q0-6 6-6h61q6 0 6-6v-9" />
          <path d="M279 238v-23q0-6-6-6h-17q-6 0-6-6v-10" />
        </g>
        <g strokeLinejoin="round" strokeLinecap="round">
          <path d="m139 135 79-35 90 37-78 36Z" fill="#263775" stroke="#a9c0ff" />
          <path d="m139 135 91 38 78-36v6l-78 36-91-38Z" fill="#3c519a" stroke="#abc2ff" />
          <path d="m146 128 76-33 79 33-75 34Z" fill="#617aba" stroke="#c1d1ff" />
          <path d="m146 128 80 34 75-34v6l-75 34-80-34Z" fill="#3a5098" stroke="#c1d1ff" />
          <path d="m154 122 69-30 70 29-68 32Z" fill="#6f84c0" stroke="#e2eaff" />
          <path d="m154 122 71 31 68-32v5l-68 31-71-30Z" fill="#465da3" stroke="#cddcff" />
          <path d="m223 108 63-28v42l-63 29Z" fill="#3b5094" stroke="#b7ccff" />
          <path d="m234 114 10-4v22l-10 5zm17-8 10-4v22l-10 5zm17-7 10-5v22l-10 5z" fill="#28397a" stroke="#9eb9fc" />
          <path d="m162 82 64 27v43l-64-27Z" fill="#344989" stroke="#b4c9f9" />
          {[0, 20, 40, 59].map((x) => (
            <g key={x} transform={`translate(${x} ${x * .423})`}>
              <path d="m160 88 5 2v32l-5-2Z" fill="#a4b9e9" stroke="#e0ebff" strokeWidth=".9" />
              <path d="m165 90 3-1.4v32l-3 1.4Z" fill="#5069ac" stroke="#b9cffd" strokeWidth=".7" />
              <path d="m158 85 8 3.5 4-1.6v3l-4 1.7-8-3.6Zm0 34 8 3.6 4-1.7v3l-4 1.8-8-3.6Z" fill="#728cc8" stroke="#d5e2ff" strokeWidth=".8" />
            </g>
          ))}
          <path d="m153 82 67-30 77 33-68 31Z" fill="#8095d1" stroke="#d4e0ff" />
          <path d="m153 82 76 34 68-31v6l-68 31-76-34Z" fill="#40569d" stroke="#d6e3ff" />
          <path d="m154 80 36-29 39 63Z" fill="#5671b5" stroke="#dce9ff" />
          <path d="m160 80 30-23 32 49Z" fill="#415a9e" stroke="#b9ccfb" />
          <path d="m190 51 67-30 39 63-67 30Z" fill="#5c74b7" stroke="#e1ebff" />
          <path d="m153 80 37-32 67-30 40 64-3 .9-38-60-66 29-36 31Z" fill="#8fa5da" stroke="#e0eaff" />
          <g stroke="#b5c9fd" strokeWidth=".8" fill="none">
            <path d="m200 55 56-25m-52 31 55-24m-51 31 55-25m-51 31 55-24m-51 31 56-25m-52 31 55-24m-51 31 55-25m-51 31 56-25" />
            <path d="m175 80 15-9 15 22Z" />
          </g>
        </g>
        <g className="lh-svg-main">
          <rect x="13" y="103" width="97" height="38" rx="4" />
          <path d="M24 115h15v11h-8l-4 3v-3h-3z" />
          <text x="46" y="127">질문 입력</text>
          <rect x="347" y="80" width="157" height="42" rx="4" />
          <path d="M359 92h8l4 4v12h-12zm8 0v5h4m-9 4h6m-6 3h5" />
          <text x="378" y="106">대출 안내 파일 만들기</text>
          <rect x="374" y="170" width="105" height="38" rx="4" />
          <path d="m387 190 13-7-4 14-3-6-6-1zm6 1 6-7" />
          <text x="406" y="194">답변 전달</text>
        </g>
        <g className="lh-svg-agent">
          <rect x="144" y="166" width="156" height="26" rx="3" />
          <text x="222" y="183" textAnchor="middle">도서관 안내 Agent</text>
        </g>
        <g className="lh-svg-reference">
          <rect x="28" y="227" width="135" height="32" rx="3" />
          <path d="M40 235h11v15H40zm3 4h5m-5 3h5m-5 3h4" />
          <text x="59" y="248">도서관 이용규정</text>
          <rect x="219" y="239" width="119" height="32" rx="3" />
          <path d="m230 251 3-4 3 4-3 4zm7 6 4-6m-2-2 3-3" />
          <text x="249" y="260">근거 인용 Skill</text>
        </g>
      </svg>
      <div className="lh-legend" aria-hidden="true">
        <span><i />실행 순서</span><span><i className="lh-dashed" />참조 연결</span>
      </div>
    </figure>
  );
}
