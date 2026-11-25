export const optionalLessonMaterials = {
  'peer-review': {
    kind:'skill', name:'교정 사유 표시 Skill',
    payload:{content:'사실 검토 담당으로서 상대 초안을 교정할 때 변경 전 문장, 변경 후 문장, 근거 자료 제목과 원문 인용을 유지하세요. 그 아래에 “교정 사유: …” 한 줄을 추가해 원문에 비추어 무엇을 왜 고쳤는지 설명하세요.'},
  },
  dynamic: {
    kind:'document', name:'강변도서관 보완 안내문',
    payload:{content:'강변도서관은 평일 오전 11시에 엽니다.'},
  },
} as const;

export type MaterialLesson = keyof typeof optionalLessonMaterials;
