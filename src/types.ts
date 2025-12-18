export interface GitHubIssue {
  id: number;
  number: number;
  title: string;
  body: string | null;
  state: 'open' | 'closed';
  labels: string[];
  created_at: string;
  updated_at: string;
  html_url: string;
}

export interface GitHubComment {
  id: number;
  author: string;
  body: string;
  created_at: string;
  updated_at: string;
  html_url: string;
}

export interface AssociatedPR {
  number: number;
  title: string;
  html_url: string;
  state: 'open' | 'closed';
  merged: boolean;
  draft: boolean;
}

export interface WorkflowState {
  id: string;
  name: string;
  type: 'backlog' | 'unstarted' | 'started' | 'completed' | 'canceled';
}

export interface SyncData {
  issue: GitHubIssue;
  comments: GitHubComment[];
  associatedPRs: AssociatedPR[];
}
