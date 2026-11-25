import type {Metadata} from 'next';
import './studio.css';
export const metadata: Metadata={title:'Workflow Studio · AI Agent 작업실',description:'블록으로 직접 설계하고 시험하는 나만의 AI Agent 작업실',icons:{icon:'/studio-icon.svg'}};
export default function Layout({children}:{children:React.ReactNode}){return <html lang="ko"><body>{children}</body></html>;}
