import { useMutation, useQueryClient } from "@tanstack/react-query";
import { MessageSquare, Send, Users } from "lucide-react";
import {
  useDataProvider,
  useGetIdentity,
  useGetList,
  useGetMany,
  useNotify,
} from "ra-core";
import { useMemo, useState } from "react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

import type { CommunityComment, CommunityPost, Sale } from "../types";

const formatRelative = (iso: string): string => {
  const date = new Date(iso);
  const diffMs = Date.now() - date.getTime();
  const m = Math.floor(diffMs / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return date.toLocaleDateString();
};

export const CommunityPage = () => {
  const { identity } = useGetIdentity();
  const dataProvider = useDataProvider();
  const notify = useNotify();
  const queryClient = useQueryClient();

  const { data: posts, isPending } = useGetList<CommunityPost>(
    "community_posts",
    {
      pagination: { page: 1, perPage: 100 },
      sort: { field: "created_at", order: "DESC" },
    },
  );

  const { data: comments } = useGetList<CommunityComment>(
    "community_comments",
    {
      pagination: { page: 1, perPage: 1000 },
      sort: { field: "created_at", order: "ASC" },
    },
  );

  const authorIds = useMemo(() => {
    const ids = new Set<string | number>();
    (posts ?? []).forEach((p) => ids.add(p.sales_id));
    (comments ?? []).forEach((c) => ids.add(c.sales_id));
    return Array.from(ids);
  }, [posts, comments]);

  const { data: authors } = useGetMany<Sale>(
    "sales",
    { ids: authorIds },
    { enabled: authorIds.length > 0 },
  );
  const authorById = useMemo(
    () => new Map((authors ?? []).map((a) => [String(a.id), a])),
    [authors],
  );
  const commentsByPostId = useMemo(() => {
    const m = new Map<string, CommunityComment[]>();
    (comments ?? []).forEach((c) => {
      const key = String(c.post_id);
      const arr = m.get(key) ?? [];
      arr.push(c);
      m.set(key, arr);
    });
    return m;
  }, [comments]);

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");

  const { mutate: createPost, isPending: posting } = useMutation({
    mutationFn: () =>
      dataProvider.create("community_posts", {
        data: { title: title.trim(), body: body.trim() },
      }),
    onSuccess: () => {
      setTitle("");
      setBody("");
      notify("crm.community.posted", {
        messageArgs: { _: "Posted" },
      });
      queryClient.invalidateQueries({ queryKey: ["community_posts"] });
    },
    onError: () =>
      notify("crm.community.post_error", {
        type: "error",
        messageArgs: { _: "Could not post" },
      }),
  });

  const canPost = title.trim().length > 0 && body.trim().length > 0 && !posting;

  return (
    <div className="max-w-3xl mx-auto py-8 px-4 space-y-6">
      <header className="flex items-center gap-3">
        <Users className="w-6 h-6 text-primary" />
        <div>
          <h1 className="text-2xl font-semibold">OSIRIS community</h1>
          <p className="text-sm text-muted-foreground">
            Trade tactics with other reps. Ask questions, share wins, drop
            scripts that worked.
          </p>
        </div>
      </header>

      <Card>
        <CardContent className="space-y-3 py-4">
          <div className="space-y-1">
            <Label htmlFor="community-title">Title</Label>
            <Input
              id="community-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="What did you learn this week?"
              disabled={posting}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="community-body">Post</Label>
            <Textarea
              id="community-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Share your story…"
              rows={4}
              disabled={posting}
            />
          </div>
          <div className="flex justify-end">
            <Button
              onClick={() => createPost()}
              disabled={!canPost}
            >
              <Send className="w-4 h-4 mr-2" />
              Post
            </Button>
          </div>
        </CardContent>
      </Card>

      {isPending ? (
        <div className="py-12 text-center text-muted-foreground">Loading…</div>
      ) : !posts || posts.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            No posts yet. Be the first.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {posts.map((post) => (
            <PostCard
              key={post.id}
              post={post}
              author={authorById.get(String(post.sales_id))}
              comments={commentsByPostId.get(String(post.id)) ?? []}
              authorById={authorById}
              currentSalesId={identity?.id}
            />
          ))}
        </div>
      )}
    </div>
  );
};

CommunityPage.path = "/community";

const PostCard = ({
  post,
  author,
  comments,
  authorById,
  currentSalesId,
}: {
  post: CommunityPost;
  author: Sale | undefined;
  comments: CommunityComment[];
  authorById: Map<string, Sale>;
  currentSalesId: string | number | undefined;
}) => {
  const dataProvider = useDataProvider();
  const notify = useNotify();
  const queryClient = useQueryClient();
  const [reply, setReply] = useState("");

  const { mutate: postComment, isPending } = useMutation({
    mutationFn: () =>
      dataProvider.create("community_comments", {
        data: { post_id: post.id, body: reply.trim() },
      }),
    onSuccess: () => {
      setReply("");
      queryClient.invalidateQueries({ queryKey: ["community_comments"] });
    },
    onError: () =>
      notify("crm.community.comment_error", {
        type: "error",
        messageArgs: { _: "Could not comment" },
      }),
  });

  const isMine = currentSalesId != null && currentSalesId === post.sales_id;

  return (
    <Card>
      <CardContent className="py-4 space-y-4">
        <header className="flex items-center gap-3">
          <Avatar className="w-8 h-8">
            <AvatarImage src={author?.avatar?.src} />
            <AvatarFallback>
              {(author?.first_name?.[0] ?? "") + (author?.last_name?.[0] ?? "")}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium">
              {author
                ? `${author.first_name} ${author.last_name}`
                : "Unknown rep"}
              {isMine ? (
                <span className="ml-2 text-xs text-muted-foreground">you</span>
              ) : null}
            </p>
            <p className="text-xs text-muted-foreground">
              {formatRelative(post.created_at)}
            </p>
          </div>
        </header>

        <div>
          <h2 className="font-semibold">{post.title}</h2>
          <p className="text-sm whitespace-pre-wrap mt-1">{post.body}</p>
        </div>

        <div className="space-y-2 pl-3 border-l">
          {comments.map((c) => {
            const a = authorById.get(String(c.sales_id));
            return (
              <div key={c.id} className="text-sm">
                <span className="font-medium">
                  {a ? `${a.first_name} ${a.last_name}` : "Unknown"}
                </span>{" "}
                <span className="text-xs text-muted-foreground">
                  {formatRelative(c.created_at)}
                </span>
                <p className="whitespace-pre-wrap">{c.body}</p>
              </div>
            );
          })}
        </div>

        <div className="flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-muted-foreground" />
          <Input
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            placeholder="Add a comment…"
            disabled={isPending}
            onKeyDown={(e) => {
              if (e.key === "Enter" && reply.trim() && !isPending) {
                postComment();
              }
            }}
          />
          <Button
            size="sm"
            onClick={() => postComment()}
            disabled={!reply.trim() || isPending}
          >
            Reply
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};
