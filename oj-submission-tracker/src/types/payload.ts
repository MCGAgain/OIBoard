export type PlatformType = 'leetcode_cn' | 'luogu' | 'acwing' | 'codeforces' | 'atcoder';

export type VerdictType =
  | 'AC'   // Accepted (通过)
  | 'WA'   // Wrong Answer
  | 'TLE'  // Time Limit Exceeded
  | 'MLE'  // Memory Limit Exceeded
  | 'RE'   // Runtime Error
  | 'CE'   // Compilation Error
  | 'PE'   // Presentation Error
  | 'PA'   // Partial Accepted (OI 赛制部分分，如洛谷 Unaccepted 但 score > 0)
  | 'OTHER';

export interface UnifiedSubmissionPayload {
  /** 平台标识 */
  platform: PlatformType;
  /** 平台原始提交记录唯一 ID (如洛谷 rid、力扣 submission_id) */
  platformSubmissionId: string;
  /** 平台题目唯一标识 (如力扣 titleSlug "two-sum"、洛谷 "P1001"、CF "1920A") */
  problemId: string;
  /** 题目标题（可选，端侧能拿到则传） */
  problemTitle?: string;
  /** 题目完整 URL */
  problemUrl: string;
  /** 用户在该平台的账号标识/昵称（可选，用于校验是否本人提交） */
  platformUserHandle?: string;
  /** 标准化判题结果 */
  verdict: VerdictType;
  /** 平台原始状态码或状态文本 (如 "10", "Accepted", "12") */
  rawStatus: string;
  /** OI 赛制得分（如洛谷 0~100 分，ACM 赛制 AC 默认 100） */
  score?: number;
  /** 编程语言 (如 "cpp", "python3", "java") */
  language: string;
  /** 用户提交的完整源代码（解决洛谷/AcWing/力扣隐私保护无法爬取源码的痛点） */
  sourceCode?: string;
  /** 运行耗时（单位：ms） */
  executionTimeMs?: number;
  /** 运行内存（单位：KB） */
  memoryUsedKb?: number;
  /** 提交时间戳（毫秒级 Unix Timestamp） */
  submittedAt: number;
  /** 客户端脚本版本号 */
  clientVersion: string;
}
