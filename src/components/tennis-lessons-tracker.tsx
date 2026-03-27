"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  addMonths,
  addYears,
  differenceInCalendarMonths,
  eachDayOfInterval,
  endOfMonth,
  format,
  isBefore,
  isSameMonth,
  isWednesday,
  parseISO,
  startOfDay,
  startOfMonth,
  subMonths,
} from "date-fns";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  AlertCircle,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Circle,
  Clock3,
  Cloud,
  CloudOff,
  Loader2,
  RotateCcw,
  Target,
  Trophy,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const PLAN_ID = "mefous-tennis-plan";
const PLAN_START = new Date(2026, 2, 1); // March 1, 2026
const PLAN_END = addYears(PLAN_START, 1);
const INITIAL_ATTENDED = ["2026-03-18"];
const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const LOCAL_STORAGE_KEY = `tennis-lessons-tracker:${PLAN_ID}`;

const SUPABASE_URL =
  (typeof process !== "undefined" && process.env.NEXT_PUBLIC_SUPABASE_URL) || "";
const SUPABASE_ANON_KEY =
  (typeof process !== "undefined" && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) || "";
const HAS_SUPABASE = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

let supabase: SupabaseClient | null = null;
if (HAS_SUPABASE) {
  supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

type SyncMode = "cloud" | "local";
type SyncState = "loading" | "ready" | "saving" | "error";

type TrackerRow = {
  plan_id: string;
  attended_dates: string[];
  updated_at?: string;
};

function toKey(date: Date) {
  return format(date, "yyyy-MM-dd");
}

function monthRange(date: Date) {
  return {
    start: startOfMonth(date),
    end: endOfMonth(date),
  };
}

function isWithinPlan(date: Date) {
  return !isBefore(date, PLAN_START) && isBefore(date, PLAN_END);
}

function getPlanDays() {
  return eachDayOfInterval({ start: PLAN_START, end: PLAN_END }).filter((day) => isBefore(day, PLAN_END));
}

function getScheduledWednesdays(days: Date[]) {
  return days.filter((day) => isWednesday(day));
}

function getMonthWednesdays(monthDate: Date) {
  return eachDayOfInterval(monthRange(monthDate)).filter((day) => isWednesday(day));
}

function getDayStatus(date: Date, attended: Set<string>, today: Date) {
  const key = toKey(date);
  const checked = attended.has(key);
  const inPlan = isWithinPlan(date);
  const pastOrToday = !isBefore(today, date);
  const scheduled = isWednesday(date);

  if (!inPlan) return "outside" as const;
  if (checked && scheduled) return "attended-scheduled" as const;
  if (checked && !scheduled) return "rescheduled" as const;
  if (scheduled && pastOrToday) return "missed" as const;
  if (scheduled) return "scheduled" as const;
  return "normal" as const;
}

function sanitizeDates(values: string[] | undefined) {
  if (!Array.isArray(values)) return INITIAL_ATTENDED;

  const valid = values.filter((value) => {
    const parsed = parseISO(value);
    return !Number.isNaN(parsed.getTime()) && isWithinPlan(parsed);
  });

  return Array.from(new Set([...INITIAL_ATTENDED, ...valid])).sort();
}

function readLocalDates() {
  if (typeof window === "undefined") return INITIAL_ATTENDED;

  try {
    const raw = window.localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!raw) return INITIAL_ATTENDED;
    return sanitizeDates(JSON.parse(raw));
  } catch {
    return INITIAL_ATTENDED;
  }
}

function writeLocalDates(dates: string[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(dates));
}

async function fetchCloudDates() {
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("tennis_tracker_plans")
    .select("plan_id, attended_dates, updated_at")
    .eq("plan_id", PLAN_ID)
    .maybeSingle<TrackerRow>();

  if (error) throw error;
  return data;
}

async function saveCloudDates(dates: string[]) {
  if (!supabase) return;

  const payload: TrackerRow = {
    plan_id: PLAN_ID,
    attended_dates: dates,
  };

  const { error } = await supabase.from("tennis_tracker_plans").upsert(payload, { onConflict: "plan_id" });
  if (error) throw error;
}

function SyncBadge({ mode, state }: { mode: SyncMode; state: SyncState }) {
  if (state === "loading") {
    return (
      <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Loading tracker
      </div>
    );
  }

  if (mode === "cloud") {
    return (
      <div className="inline-flex items-center gap-2 rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-medium text-sky-700">
        <Cloud className="h-3.5 w-3.5" />
        {state === "saving" ? "Saving online" : state === "error" ? "Cloud sync error" : "Synced online"}
      </div>
    );
  }

  return (
    <div className="inline-flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700">
      <CloudOff className="h-3.5 w-3.5" />
      {state === "error" ? "Local save error" : "Local only mode"}
    </div>
  );
}

export default function TennisLessonsTracker() {
  const [currentMonth, setCurrentMonth] = useState<Date>(new Date());
  const [attended, setAttended] = useState<Set<string>>(new Set(INITIAL_ATTENDED));
  const [syncMode, setSyncMode] = useState<SyncMode>(HAS_SUPABASE ? "cloud" : "local");
  const [syncState, setSyncState] = useState<SyncState>("loading");
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);

  const today = startOfDay(new Date());
  const planDays = useMemo(() => getPlanDays(), []);
  const scheduledWednesdays = useMemo(() => getScheduledWednesdays(planDays), [planDays]);
  const attendedKeys = useMemo(() => Array.from(attended).sort(), [attended]);

  useEffect(() => {
    let cancelled = false;

    async function loadTracker() {
      setSyncState("loading");

      if (HAS_SUPABASE && supabase) {
        try {
          const cloudRow = await fetchCloudDates();
          const localDates = readLocalDates();
          const mergedDates = sanitizeDates([
            ...(cloudRow?.attended_dates || []),
            ...localDates,
          ]);

          if (!cancelled) {
            setAttended(new Set(mergedDates));
            setSyncMode("cloud");
            setSyncState("ready");
            setLastSavedAt(cloudRow?.updated_at || null);
          }

          writeLocalDates(mergedDates);

          if (!cloudRow) {
            await saveCloudDates(mergedDates);
          }

          return;
        } catch {
          if (!cancelled) {
            const localDates = readLocalDates();
            setAttended(new Set(localDates));
            setSyncMode("local");
            setSyncState("ready");
          }
          return;
        }
      }

      const localDates = readLocalDates();
      if (!cancelled) {
        setAttended(new Set(localDates));
        setSyncMode("local");
        setSyncState("ready");
      }
    }

    loadTracker();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (syncState === "loading") return;

    writeLocalDates(attendedKeys);

    if (!HAS_SUPABASE || !supabase) return;

    let cancelled = false;

    async function persist() {
      setSyncState("saving");
      try {
        await saveCloudDates(attendedKeys);
        if (!cancelled) {
          setSyncMode("cloud");
          setSyncState("ready");
          setLastSavedAt(new Date().toISOString());
        }
      } catch {
        if (!cancelled) {
          setSyncMode("local");
          setSyncState("error");
        }
      }
    }

    persist();

    return () => {
      cancelled = true;
    };
  }, [attendedKeys, syncState]);

  useEffect(() => {
    if (!HAS_SUPABASE || !supabase) return;

    const channel = supabase
      .channel(`tennis-tracker:${PLAN_ID}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "tennis_tracker_plans",
          filter: `plan_id=eq.${PLAN_ID}`,
        },
        (payload) => {
          const nextDates = sanitizeDates((payload.new as TrackerRow)?.attended_dates || []);
          setAttended(new Set(nextDates));
          setSyncMode("cloud");
          setSyncState("ready");
          setLastSavedAt((payload.new as TrackerRow)?.updated_at || new Date().toISOString());
        }
      )
      .subscribe();

    return () => {
      supabase?.removeChannel(channel);
    };
  }, []);

  const pastScheduled = scheduledWednesdays.filter((day) => !isBefore(today, day));
  const attendedDates = attendedKeys.map((d) => parseISO(d));
  const missedScheduled = pastScheduled.filter((day) => !attended.has(toKey(day)));
  const attendedInPlanSoFar = attendedDates.filter((day) => isWithinPlan(day) && !isBefore(today, day));
  const rescheduledTaken = attendedInPlanSoFar.filter((day) => !isWednesday(day));
  const reschedulesAvailable = Math.max(missedScheduled.length - rescheduledTaken.length, 0);

  const currentMonthWednesdays = getMonthWednesdays(currentMonth);
  const currentMonthPastWednesdays = currentMonthWednesdays.filter((day) => !isBefore(today, day));
  const currentMonthAttendedOnWednesday = currentMonthPastWednesdays.filter((day) => attended.has(toKey(day)));
  const currentMonthMissed = currentMonthPastWednesdays.filter((day) => !attended.has(toKey(day)));
  const currentMonthRescheduled = attendedDates.filter(
    (day) => isSameMonth(day, currentMonth) && !isWednesday(day) && !isBefore(today, day) && isWithinPlan(day)
  );
  const currentMonthReschedulesLeft = Math.max(currentMonthMissed.length - currentMonthRescheduled.length, 0);

  const visibleMonthDays = eachDayOfInterval(monthRange(currentMonth));
  const firstWeekday = (startOfMonth(currentMonth).getDay() + 6) % 7;
  const leadingBlanks = Array.from({ length: firstWeekday }, (_, i) => `blank-${i}`);

  const stats = [
    {
      title: "Lessons taken",
      value: attendedInPlanSoFar.length,
      icon: Check,
      subtitle: "All checked days in your plan",
    },
    {
      title: "Missed Wednesdays",
      value: missedScheduled.length,
      icon: AlertCircle,
      subtitle: "Past regular lessons not checked",
    },
    {
      title: "Reschedules left",
      value: reschedulesAvailable,
      icon: RotateCcw,
      subtitle: "Missed lessons still to make up",
    },
    {
      title: "Plan progress",
      value: `${attendedInPlanSoFar.length}/${pastScheduled.length || 0}`,
      icon: Target,
      subtitle: "All lessons taken vs. scheduled lessons so far",
    },
  ];

  function toggleAttendance(date: Date) {
    if (!isWithinPlan(date)) return;

    const key = toKey(date);
    setAttended((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(190,242,100,0.28),_transparent_28%),linear-gradient(180deg,_#f7fee7_0%,_#f8fafc_38%,_#eef2ff_100%)] p-6 md:p-10">
      <div className="relative mx-auto max-w-7xl space-y-6">
        <div className="absolute inset-x-0 top-0 -z-10 mx-auto hidden h-72 max-w-5xl rounded-full bg-lime-200/25 blur-3xl md:block" />

        <div className="relative overflow-hidden rounded-[2rem] border border-white/60 bg-white/75 p-6 shadow-[0_20px_60px_rgba(15,23,42,0.08)] backdrop-blur md:p-8">
          <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full border-[18px] border-lime-300/60" />
          <div className="absolute right-16 top-8 hidden h-24 w-24 rounded-full border border-lime-200/80 md:block" />
          <div className="absolute bottom-0 left-0 h-2 w-full bg-[linear-gradient(90deg,#84cc16_0%,#65a30d_25%,#eab308_50%,#65a30d_75%,#84cc16_100%)] opacity-80" />

          <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
            <div>
              <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-lime-200 bg-lime-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-lime-700">
                <Circle className="h-3.5 w-3.5 fill-current" />
                Court season tracker
              </div>
              <h1 className="text-3xl font-semibold tracking-tight text-slate-900 md:text-4xl">Tennis Lessons Tracker</h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">
                Check the days you actually took class. The tracker saves automatically and can sync across devices when Supabase is configured.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl border border-lime-100 bg-white/90 px-4 py-3 shadow-sm">
                <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-slate-500">
                  <Trophy className="h-4 w-4 text-lime-600" />
                  Plan window
                </div>
                <div className="mt-1 text-sm font-semibold text-slate-800">
                  {format(PLAN_START, "MMM d, yyyy")} — {format(PLAN_END, "MMM d, yyyy")}
                </div>
              </div>

              <div className="rounded-2xl border border-sky-100 bg-gradient-to-br from-sky-50 to-white px-4 py-3 shadow-sm">
                <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Surface</div>
                <div className="mt-1 text-sm font-semibold text-slate-800">Hard court mindset</div>
              </div>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <SyncBadge mode={syncMode} state={syncState} />
            <div className="text-xs text-slate-500">
              Plan ID: <span className="font-semibold text-slate-700">{PLAN_ID}</span>
            </div>
            {lastSavedAt ? (
              <div className="text-xs text-slate-500">Last sync: {format(parseISO(lastSavedAt), "MMM d, yyyy • HH:mm")}</div>
            ) : null}
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {stats.map((stat) => {
            const Icon = stat.icon;

            return (
              <Card
                key={stat.title}
                className="overflow-hidden rounded-[1.75rem] border border-white/70 bg-white/85 shadow-[0_15px_45px_rgba(15,23,42,0.08)] backdrop-blur"
              >
                <CardContent className="relative p-5">
                  <div className="absolute right-0 top-0 h-16 w-16 rounded-bl-[2rem] bg-lime-100/70" />
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-sm text-slate-500">{stat.title}</p>
                      <p className="mt-2 text-3xl font-semibold tracking-tight text-slate-900">{stat.value}</p>
                    </div>
                    <div className="rounded-2xl bg-gradient-to-br from-lime-100 to-emerald-50 p-3 shadow-sm">
                      <Icon className="h-5 w-5 text-lime-700" />
                    </div>
                  </div>
                  <p className="mt-3 text-xs text-slate-500">{stat.subtitle}</p>
                </CardContent>
              </Card>
            );
          })}
        </div>

        <div className="grid gap-6 xl:grid-cols-[1.7fr_0.9fr]">
          <Card className="overflow-hidden rounded-[2rem] border border-white/70 bg-white/85 shadow-[0_18px_50px_rgba(15,23,42,0.08)] backdrop-blur">
            <CardHeader className="border-b border-lime-100/80 bg-[linear-gradient(135deg,rgba(236,253,245,0.9),rgba(254,249,195,0.65))] pb-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <CardTitle className="flex items-center gap-2 text-xl text-slate-900">
                    <CalendarDays className="h-5 w-5 text-lime-700" />
                    {format(currentMonth, "MMMM yyyy")}
                  </CardTitle>
                  <p className="mt-1 text-sm text-slate-500">
                    Wednesdays are your regular classes. Click any day you attended.
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="icon"
                    className="rounded-2xl border-lime-200 bg-white/90 hover:bg-lime-50"
                    onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    className="rounded-2xl border-lime-200 bg-white/90 hover:bg-lime-50"
                    onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </CardHeader>

            <CardContent className="space-y-4">
              <div className="grid grid-cols-7 gap-2 rounded-2xl bg-lime-50/70 p-2 text-center text-xs font-medium uppercase tracking-wide text-slate-600">
                {WEEKDAY_LABELS.map((day) => (
                  <div key={day} className="py-2">
                    {day}
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-7 gap-2">
                {leadingBlanks.map((key) => (
                  <div key={key} className="min-h-20 rounded-2xl bg-transparent" />
                ))}

                {visibleMonthDays.map((date) => {
                  const status = getDayStatus(date, attended, today);
                  const checked = attended.has(toKey(date));
                  const canToggle = isWithinPlan(date);

                  return (
                    <button
                      key={toKey(date)}
                      onClick={() => toggleAttendance(date)}
                      className={cn(
                        "relative min-h-20 rounded-2xl border p-3 text-left transition-all",
                        "hover:-translate-y-0.5 hover:shadow-md",
                        canToggle ? "cursor-pointer" : "cursor-not-allowed opacity-50",
                        status === "normal" && "border-slate-200 bg-white",
                        status === "scheduled" && "border-lime-200 bg-lime-50/70",
                        status === "missed" && "border-amber-200 bg-amber-50",
                        status === "attended-scheduled" && "border-emerald-200 bg-emerald-50",
                        status === "rescheduled" && "border-sky-200 bg-sky-50",
                        status === "outside" && "border-slate-100 bg-slate-50 text-slate-400"
                      )}
                    >
                      <div className="flex items-start justify-between">
                        <span className="text-sm font-medium">{format(date, "d")}</span>
                        {checked ? (
                          <div className="rounded-full bg-slate-900 p-1 text-white">
                            <Check className="h-3 w-3" />
                          </div>
                        ) : null}
                      </div>

                      <div className="mt-4 flex flex-wrap gap-1">
                        {isWednesday(date) && (
                          <Badge variant="secondary" className="rounded-lg border-0 bg-lime-100 text-lime-800">
                            Lesson
                          </Badge>
                        )}
                        {status === "missed" && (
                          <Badge className="rounded-lg border-0 bg-amber-100 text-amber-800">Missed</Badge>
                        )}
                        {status === "rescheduled" && (
                          <Badge className="rounded-lg border-0 bg-sky-100 text-sky-800">Make-up</Badge>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          <div className="space-y-6">
            <Card className="rounded-[1.75rem] border border-white/70 bg-white/85 shadow-[0_15px_45px_rgba(15,23,42,0.08)] backdrop-blur">
              <CardHeader>
                <CardTitle className="text-lg">This month</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 text-sm">
                <div className="flex items-center justify-between rounded-2xl border border-lime-100/70 bg-gradient-to-r from-lime-50 to-white p-4">
                  <span className="text-slate-600">Regular Wednesdays</span>
                  <span className="font-semibold">{currentMonthWednesdays.length}</span>
                </div>
                <div className="flex items-center justify-between rounded-2xl border border-lime-100/70 bg-gradient-to-r from-lime-50 to-white p-4">
                  <span className="text-slate-600">Attended on Wednesday</span>
                  <span className="font-semibold">{currentMonthAttendedOnWednesday.length}</span>
                </div>
                <div className="flex items-center justify-between rounded-2xl border border-lime-100/70 bg-gradient-to-r from-lime-50 to-white p-4">
                  <span className="text-slate-600">Missed so far</span>
                  <span className="font-semibold">{currentMonthMissed.length}</span>
                </div>
                <div className="flex items-center justify-between rounded-2xl border border-lime-100/70 bg-gradient-to-r from-lime-50 to-white p-4">
                  <span className="text-slate-600">Make-up lessons done</span>
                  <span className="font-semibold">{currentMonthRescheduled.length}</span>
                </div>
                <div className="flex items-center justify-between rounded-2xl bg-[linear-gradient(135deg,#365314,#65a30d)] p-4 text-white">
                  <span>Still left to reschedule</span>
                  <span className="text-lg font-semibold">{currentMonthReschedulesLeft}</span>
                </div>
              </CardContent>
            </Card>

            <Card className="rounded-[1.75rem] border border-white/70 bg-white/85 shadow-[0_15px_45px_rgba(15,23,42,0.08)] backdrop-blur">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Clock3 className="h-5 w-5 text-lime-700" />
                  How it works
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm text-slate-600">
                <p>• Every Wednesday counts as your regular class.</p>
                <p>• If a past Wednesday is not checked, it counts as missed.</p>
                <p>• Any checked non-Wednesday counts as a make-up lesson.</p>
                <p>• Plan progress counts every completed lesson, including make-ups.</p>
                <p>• Reschedules left = missed Wednesdays - make-up lessons already taken.</p>
                <p>• With Supabase configured, changes sync across phone and computer.</p>
              </CardContent>
            </Card>

            <Card className="rounded-[1.75rem] border border-white/70 bg-white/85 shadow-[0_15px_45px_rgba(15,23,42,0.08)] backdrop-blur">
              <CardHeader>
                <CardTitle className="text-lg">Setup for online sync</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm text-slate-600">
                <p>1. Create a Supabase project.</p>
                <p>2. Add a table called <span className="font-semibold text-slate-900">tennis_tracker_plans</span>.</p>
                <p>3. Use <span className="font-semibold text-slate-900">plan_id</span> as primary key and <span className="font-semibold text-slate-900">attended_dates</span> as <span className="font-semibold text-slate-900">text[]</span>.</p>
                <p>4. Add <span className="font-semibold text-slate-900">NEXT_PUBLIC_SUPABASE_URL</span> and <span className="font-semibold text-slate-900">NEXT_PUBLIC_SUPABASE_ANON_KEY</span>.</p>
                <p>5. Deploy the app and open the same tracker on your phone and computer.</p>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
