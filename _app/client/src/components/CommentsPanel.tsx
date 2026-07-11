import React, { useState, useEffect, useRef } from 'react';
import { MessageCircle, Send, X, Check, Trash2, Reply, Quote } from 'lucide-react';
import { t, type Lang } from '../utils/translations';

// ─── Interfaces ────────────────────────────────────────────────────

export interface Comment {
  id: number;
  relative_path: string;
  parent_id: number | null;
  author_id: number;
  author_name: string;
  content: string;
  quoted_text: string | null;
  status: 'open' | 'resolved';
  resolved_by: string | null;
  approved: number;
  created_at: string;
  updated_at: string | null;
}

interface CommentsPanelProps {
  notePath: string;
  currentUser: { id: number; username: string; role: string };
  noteCreator: string;
  socket: any;
  lang: Lang;
  onClose: () => void;
  pendingQuote?: string | null;
  onClearPendingQuote?: () => void;
}

interface CommentNode extends Comment {
  replies: CommentNode[];
}

// ─── Helpers ───────────────────────────────────────────────────────

const formatRelativeDate = (dateStr: string, lang: Lang): string => {
  // If the date string does not contain timezone information (standard SQLite output like YYYY-MM-DD HH:MM:SS),
  // convert it to ISO format and append 'Z' to parse it correctly as UTC.
  const cleanDateStr = dateStr.includes('T') || dateStr.includes('Z') 
    ? dateStr 
    : dateStr.replace(' ', 'T') + 'Z';
  const date = new Date(cleanDateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffMins < 1) return lang === 'en' ? 'just now' : 'только что';
  if (diffMins < 60) return lang === 'en' ? `${diffMins}m ago` : `${diffMins} мин. назад`;
  if (diffHours < 24) return lang === 'en' ? `${diffHours}h ago` : `${diffHours} ч. назад`;
  if (diffDays < 7) return lang === 'en' ? `${diffDays}d ago` : `${diffDays} дн. назад`;
  return date.toLocaleDateString();
};

const buildCommentTree = (comments: Comment[]): CommentNode[] => {
  const map = new Map<number, CommentNode>();
  const roots: CommentNode[] = [];

  for (const c of comments) {
    map.set(c.id, { ...c, replies: [] });
  }

  for (const node of map.values()) {
    if (node.parent_id !== null) {
      const parent = map.get(node.parent_id);
      if (parent) {
        parent.replies.push(node);
      }
    } else {
      roots.push(node);
    }
  }

  // Root comments: newest first
  roots.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  // Replies: oldest first
  for (const node of map.values()) {
    if (node.replies.length > 1) {
      node.replies.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    }
  }

  return roots;
};

// ─── Component ─────────────────────────────────────────────────────

const CommentsPanel: React.FC<CommentsPanelProps> = ({
  notePath,
  currentUser,
  noteCreator,
  socket,
  lang,
  onClose,
  pendingQuote,
  onClearPendingQuote,
}) => {
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [newComment, setNewComment] = useState('');
  const [replyingTo, setReplyingTo] = useState<number | null>(null);
  const [replyText, setReplyText] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const newCommentRef = useRef<HTMLTextAreaElement>(null);

  // ─── Fetch comments ─────────────────────────────────────────────

  const fetchComments = async () => {
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/comments/for/${encodeURIComponent(notePath)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setComments(data);
      }
    } catch {
      // silently ignore network errors
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setLoading(true);
    fetchComments();
  }, [notePath]);

  // ─── Socket listeners ───────────────────────────────────────────

  useEffect(() => {
    if (!socket) return;

    const handleCreated = (data: { relative_path: string }) => {
      if (data.relative_path === notePath) fetchComments();
    };
    const handleResolved = (data: { relative_path: string }) => {
      if (data.relative_path === notePath) fetchComments();
    };
    const handleDeleted = (data: { relative_path: string }) => {
      if (data.relative_path === notePath) fetchComments();
    };
    const handleApproved = (data: { relative_path: string }) => {
      if (data.relative_path === notePath) fetchComments();
    };

    socket.on('comment:created', handleCreated);
    socket.on('comment:resolved', handleResolved);
    socket.on('comment:deleted', handleDeleted);
    socket.on('comment:approved', handleApproved);

    return () => {
      socket.off('comment:created', handleCreated);
      socket.off('comment:resolved', handleResolved);
      socket.off('comment:deleted', handleDeleted);
      socket.off('comment:approved', handleApproved);
    };
  }, [socket, notePath]);

  // ─── Focus textarea when pendingQuote arrives ───────────────────

  useEffect(() => {
    if (pendingQuote && newCommentRef.current) {
      newCommentRef.current.focus();
    }
  }, [pendingQuote]);

  // ─── Actions ────────────────────────────────────────────────────

  const submitComment = async (parentId: number | null = null) => {
    const content = parentId !== null ? replyText.trim() : newComment.trim();
    if (!content) return;

    setSubmitting(true);
    try {
      const token = localStorage.getItem('token');
      const body: any = {
        relative_path: notePath,
        content,
      };
      if (parentId !== null) {
        body.parent_id = parentId;
      } else {
        body.quoted_text = pendingQuote || null;
      }

      const res = await fetch('/api/comments', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        if (parentId !== null) {
          setReplyText('');
          setReplyingTo(null);
        } else {
          setNewComment('');
          onClearPendingQuote?.();
        }
        await fetchComments();
      }
    } catch {
      // silently ignore
    } finally {
      setSubmitting(false);
    }
  };

  const resolveComment = async (commentId: number) => {
    try {
      const token = localStorage.getItem('token');
      await fetch(`/api/comments/${commentId}/resolve`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}` },
      });
      await fetchComments();
    } catch {
      // silently ignore
    }
  };

  const approveComment = async (commentId: number) => {
    try {
      const token = localStorage.getItem('token');
      await fetch(`/api/comments/${commentId}/approve`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}` },
      });
      await fetchComments();
    } catch {
      // silently ignore
    }
  };

  const deleteComment = async (commentId: number) => {
    if (!confirm(t('comments_delete_confirm', lang))) return;
    try {
      const token = localStorage.getItem('token');
      await fetch(`/api/comments/${commentId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      await fetchComments();
    } catch {
      // silently ignore
    }
  };

  // ─── Permission helpers ─────────────────────────────────────────

  const canResolve = (): boolean => {
    return (
      currentUser.role === 'Admin' ||
      currentUser.username === noteCreator
    );
  };

  const canDelete = (comment: Comment): boolean => {
    return (
      currentUser.role === 'Admin' ||
      currentUser.id === comment.author_id
    );
  };

  // ─── Build tree ─────────────────────────────────────────────────

  const tree = buildCommentTree(comments);
  const totalCount = comments.filter((c) => c.parent_id === null).length;
  const hasActive = comments.some((c) => c.parent_id === null && c.status === 'open');

  // ─── Render helpers ─────────────────────────────────────────────

  const renderAvatar = (name: string) => (
    <div className="w-6 h-6 rounded-md bg-primary/20 border border-primary/30 flex items-center justify-center text-primary font-bold uppercase text-[10px] shrink-0">
      {name.charAt(0)}
    </div>
  );

  const renderReply = (reply: CommentNode) => {
    const isPending = !reply.approved;
    const isResolved = reply.status === 'resolved';

    return (
      <div 
        key={reply.id} 
        className={`flex gap-2 items-start transition-all ${
          isResolved ? 'opacity-60' : isPending ? 'opacity-75 border-l border-yellow-500/30 pl-2' : ''
        }`}
      >
        {renderAvatar(reply.author_name)}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-white truncate">{reply.author_name}</span>
            <span className="text-[9px] text-text-disabled shrink-0">{formatRelativeDate(reply.created_at, lang)}</span>
          </div>
          <p className="text-xs text-text-muted leading-relaxed mt-0.5">{reply.content}</p>


          {/* Action buttons for replies */}
          <div className="flex items-center gap-1.5 mt-1 pt-1">
            {/* Approve button for pending replies — only owner/admin */}
            {canResolve() && !reply.approved && !isResolved && (
              <button
                onClick={() => approveComment(reply.id)}
                className="flex items-center gap-0.5 text-[9px] text-blue-400/70 hover:text-blue-400 px-1.5 py-0.5 rounded-full hover:bg-blue-400/10 transition-colors cursor-pointer"
              >
                <Check size={9} />
                {t('comments_approve', lang)}
              </button>
            )}

            {/* Pending indicator for reply author */}
            {!canResolve() && !reply.approved && !isResolved && (
              <span className="flex items-center gap-0.5 text-[9px] text-yellow-400/60 px-1.5 py-0.5">
                {t('comments_pending_approval', lang)}
              </span>
            )}

            {canDelete(reply) && (
              <button
                onClick={() => deleteComment(reply.id)}
                className="flex items-center gap-0.5 text-[9px] text-red-400/60 hover:text-red-400 px-1.5 py-0.5 rounded-full hover:bg-red-400/10 transition-colors cursor-pointer ml-auto"
              >
                <Trash2 size={9} />
                {t('comments_delete', lang)}
              </button>
            )}
          </div>
        </div>
      </div>
    );
  };

  const renderCommentCard = (node: CommentNode) => {
    const isResolved = node.status === 'resolved';
    const isReplyingToThis = replyingTo === node.id;

    const isPending = !node.approved;

    return (
      <div
        key={node.id}
        className={`p-3 rounded-xl border bg-white/[0.02] transition-all ${
          isResolved ? 'opacity-60 border-white/5' : isPending ? 'opacity-75 border-l-2 border-l-yellow-500/50 border-t-white/5 border-r-white/5 border-b-white/5' : 'border-white/5'
        }`}
      >
        {/* Header */}
        <div className="flex items-center gap-2">
          {renderAvatar(node.author_name)}
          <div className="flex-1 min-w-0 flex items-center gap-2">
            <span className="text-xs font-bold text-white truncate">{node.author_name}</span>
            <span className="text-[9px] text-text-disabled shrink-0">{formatRelativeDate(node.created_at, lang)}</span>
          </div>
        </div>

        {/* Quoted text */}
        {node.quoted_text && (
          <div className="border-l-2 border-primary/50 pl-3 py-1.5 my-1.5 text-[11px] text-text-muted italic bg-primary/5 rounded-r-lg">
            "{node.quoted_text}"
          </div>
        )}

        {/* Content */}
        <p className="text-xs text-text-muted leading-relaxed mt-1">{node.content}</p>



        {/* Replies */}
        {node.replies.length > 0 && (
          <div className="ml-6 mt-2 pl-3 border-l border-white/5 space-y-2">
            {node.replies.map(renderReply)}
          </div>
        )}

        {/* Inline reply input */}
        {isReplyingToThis && (
          <div className="ml-6 mt-2 pl-3 border-l border-white/5">
            <div className="flex gap-2 items-end">
              <textarea
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                placeholder={t('comments_reply_placeholder', lang)}
                className="flex-1 bg-black/40 border border-white/5 rounded-lg text-xs text-text placeholder-text-disabled focus:outline-none focus:border-primary/50 p-2.5 resize-none"
                rows={2}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    submitComment(node.id);
                  }
                }}
              />
              <button
                onClick={() => submitComment(node.id)}
                disabled={!replyText.trim() || submitting}
                className="bg-primary/20 border border-primary/30 hover:bg-primary/40 text-primary rounded-lg p-1.5 transition-colors cursor-pointer disabled:opacity-30 shrink-0"
                title={t('comments_send', lang)}
              >
                <Send size={14} />
              </button>
            </div>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex items-center gap-1.5 mt-2 pt-1.5 border-t border-white/[0.03]">
          <button
            onClick={() => {
              if (isReplyingToThis) {
                setReplyingTo(null);
                setReplyText('');
              } else {
                setReplyingTo(node.id);
                setReplyText('');
              }
            }}
            className="flex items-center gap-1 text-[10px] text-text-disabled hover:text-text-muted px-2 py-1 rounded-full hover:bg-white/5 transition-colors cursor-pointer"
          >
            <Reply size={11} />
            {t('comments_reply', lang)}
          </button>

          {/* Approve button for pending comments — only owner/admin */}
          {canResolve() && !node.approved && !isResolved && (
            <button
              onClick={() => approveComment(node.id)}
              className="flex items-center gap-1 text-[10px] text-blue-400/70 hover:text-blue-400 px-2 py-1 rounded-full hover:bg-blue-400/10 transition-colors cursor-pointer"
            >
              <Check size={11} />
              {t('comments_approve', lang)}
            </button>
          )}

          {canResolve() && !!node.approved && !isResolved && (
            <button
              onClick={() => resolveComment(node.id)}
              className="flex items-center gap-1 text-[10px] text-green-400/70 hover:text-green-400 px-2 py-1 rounded-full hover:bg-green-400/10 transition-colors cursor-pointer"
            >
              <Check size={11} />
              {t('comments_resolve', lang)}
            </button>
          )}

          {/* Pending indicator for the comment author (non-owner view) */}
          {!canResolve() && !node.approved && !isResolved && (
            <span className="flex items-center gap-1 text-[10px] text-yellow-400/60 px-2 py-1">
              {t('comments_pending_approval', lang)}
            </span>
          )}

          {canDelete(node) && (
            <button
              onClick={() => deleteComment(node.id)}
              className="flex items-center gap-1 text-[10px] text-red-400/60 hover:text-red-400 px-2 py-1 rounded-full hover:bg-red-400/10 transition-colors cursor-pointer ml-auto"
            >
              <Trash2 size={11} />
              {t('comments_delete', lang)}
            </button>
          )}
        </div>
      </div>
    );
  };

  // ─── Main render ────────────────────────────────────────────────

  return (
    <div className="w-80 border-l border-white/5 bg-black/30 backdrop-blur-md flex flex-col h-full select-none shrink-0">
      {/* Header */}
      <div className="p-4 border-b border-white/5 bg-black/20">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MessageCircle size={16} className="text-primary" />
            <span className="text-sm font-bold text-white">{t('comments_title', lang)}</span>
            {totalCount > 0 && (
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full border font-medium ${
                hasActive 
                  ? 'bg-primary/20 text-primary border-primary/30' 
                  : 'bg-white/5 text-text-disabled border-white/10'
              }`}>
                {totalCount}
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="text-text-disabled hover:text-white p-1 rounded-lg hover:bg-white/5 transition-colors cursor-pointer"
            title={t('sidebar_notifications_close', lang)}
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Comment list */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-3">
        {loading ? (
          <div className="flex items-center justify-center h-32">
            <div className="text-xs text-text-disabled">{t('auth_loading', lang)}</div>
          </div>
        ) : tree.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 py-12">
            <MessageCircle size={40} className="text-white/10" />
            <p className="text-xs text-text-disabled font-medium">{t('comments_empty', lang)}</p>
            <p className="text-[10px] text-text-disabled/60 text-center px-4 leading-relaxed">
              {t('comments_empty_hint', lang)}
            </p>
          </div>
        ) : (
          tree.map(renderCommentCard)
        )}
      </div>

      {/* New comment form (sticky bottom) */}
      <div className="p-3 border-t border-white/5 bg-black/20 space-y-2">
        {/* Pending quote preview */}
        {pendingQuote && (
          <div className="flex items-start gap-2 border-l-2 border-primary/50 pl-2.5 py-1.5 bg-primary/5 rounded-r-lg">
            <Quote size={12} className="text-primary/60 mt-0.5 shrink-0" />
            <p className="flex-1 text-[10px] text-text-muted italic leading-relaxed line-clamp-3">
              "{pendingQuote}"
            </p>
            <button
              onClick={() => onClearPendingQuote?.()}
              className="text-text-disabled hover:text-white p-0.5 rounded hover:bg-white/5 transition-colors cursor-pointer shrink-0"
            >
              <X size={12} />
            </button>
          </div>
        )}

        {/* Input area */}
        <div className="flex gap-2 items-end">
          <textarea
            ref={newCommentRef}
            value={newComment}
            onChange={(e) => setNewComment(e.target.value)}
            placeholder={t('comments_new_placeholder', lang)}
            className="flex-1 bg-black/40 border border-white/5 rounded-lg text-xs text-text placeholder-text-disabled focus:outline-none focus:border-primary/50 p-2.5 resize-none"
            rows={2}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                submitComment(null);
              }
            }}
          />
          <button
            onClick={() => submitComment(null)}
            disabled={!newComment.trim() || submitting}
            className="bg-primary/20 border border-primary/30 hover:bg-primary/40 text-primary rounded-lg p-1.5 transition-colors cursor-pointer disabled:opacity-30 shrink-0"
            title={t('comments_send', lang)}
          >
            <Send size={14} />
          </button>
        </div>
      </div>
    </div>
  );
};

export default CommentsPanel;
