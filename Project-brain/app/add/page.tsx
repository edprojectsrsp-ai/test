"use client";

import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle,
  Save,
  SkipForward,
  UploadCloud,
} from "lucide-react";
import Link from "next/link";
import { useMos } from "@/components/brain/MosContext";

const API_URL = "http://localhost:8000/api/v1/schemes";

type SchemeType = "corporate" | "plant" | "dummy";
type SchemeStatus =
  | "under_formulation"
  | "under_stage1"
  | "under_tendering"
  | "under_stage2"
  | "ongoing"
  | "closed";

type DateFields = {
  stage1_date: string;
  stage2_date: string;
  start_date: string;
  scheduled_completion_date: string;
  expected_completion_date: string;
  closure_date: string;
  remarks: string;
};

type Match = {
  id: number;
  name: string;
  exact: boolean;
  confidence?: number;
};

const dateFields: { id: keyof DateFields; label: string }[] = [
  { id: "stage1_date", label: "Stage-I Date" },
  { id: "stage2_date", label: "Stage-II Date" },
  { id: "start_date", label: "Start Date" },
  { id: "scheduled_completion_date", label: "Scheduled Completion" },
  { id: "expected_completion_date", label: "Expected Completion" },
  { id: "closure_date", label: "Closure Date" },
];

const cardClass =
  "rounded-3xl border border-[var(--line)] bg-[var(--panel)] p-8 shadow-[var(--shadow-lg)]";
const labelClass = "mb-2 block text-sm text-[var(--ink-3)]";
const controlClass =
  "glass-input w-full rounded-2xl border border-[var(--line-2)] bg-[var(--panel)] px-5 py-4 text-lg text-[var(--ink)] outline-none transition-all placeholder:text-[var(--ink-4)] focus:border-[var(--steel)]";

export default function AddSchemeWizard() {
  const { focusField, speakAndChat } = useMos();
  const [step, setStep] = useState(1);
  const [schemeId, setSchemeId] = useState<number | null>(null);
  const [typeGlow, setTypeGlow] = useState("");

  const [name, setName] = useState("");
  const [estCost, setEstCost] = useState("");
  const [type, setType] = useState<SchemeType>("corporate");
  const [status, setStatus] = useState<SchemeStatus>("under_formulation");
  const [similarNames, setSimilarNames] = useState<Match[]>([]);
  const [forceProceed, setForceProceed] = useState(false);

  const [dates, setDates] = useState<DateFields>({
    stage1_date: "",
    stage2_date: "",
    start_date: "",
    scheduled_completion_date: "",
    expected_completion_date: "",
    closure_date: "",
    remarks: "",
  });

  const [parentId, setParentId] = useState("");
  const [availableParents, setAvailableParents] = useState<
    { id: number; scheme_name: string }[]
  >([]);
  const [isLoading, setIsLoading] = useState(false);

  const mandatoryFields = useMemo(() => {
    let required: (keyof DateFields)[] = [];

    if (type === "corporate") {
      if (["under_stage1", "under_tendering"].includes(status)) {
        required = ["stage1_date"];
      }
      if (status === "under_stage2") {
        required = ["stage1_date", "stage2_date"];
      }
      if (status === "ongoing") {
        required = [
          "stage1_date",
          "stage2_date",
          "start_date",
          "scheduled_completion_date",
        ];
      }
      if (status === "closed") {
        required = ["closure_date"];
      }
    } else if (type === "plant") {
      if (status === "ongoing") {
        required = ["start_date", "scheduled_completion_date"];
      }
      if (status === "closed") {
        required = ["closure_date"];
      }
    }

    return required;
  }, [status, type]);

  const checkCostLogic = () => {
    const val = parseFloat(estCost);
    if (Number.isNaN(val)) return;

    if (val >= 30) {
      setType("corporate");
      setTypeGlow("ring-4 ring-[var(--steel)]");
      speakAndChat(
        `Cost is ${val} Cr. I suggest Corporate AMR. Pre-selected for you.`,
        ":)",
      );
    } else if (val > 0 && val < 30) {
      setType("plant");
      setTypeGlow("ring-4 ring-[var(--verdigris)]");
      speakAndChat(
        `Cost is ${val} Cr. This is Plant AMR. Updated type for you.`,
        ":)",
      );
    }

    setTimeout(() => setTypeGlow(""), 1500);
  };

  const isMandatory = (field: keyof DateFields) => mandatoryFields.includes(field);

  const dateInputClass = (field: keyof DateFields) =>
    `w-full rounded-2xl border bg-[var(--panel)] px-5 py-4 text-[var(--ink)] outline-none transition-all ${
      isMandatory(field)
        ? "border-[var(--steel)] shadow-[0_0_15px_color-mix(in_srgb,var(--steel)_20%,transparent)] focus:shadow-[0_0_20px_color-mix(in_srgb,var(--steel)_35%,transparent)]"
        : "border-[var(--line-2)] focus:border-[var(--steel-dim)]"
    }`;

  const handleStep1Submit = async () => {
    if (!name.trim()) {
      alert("Scheme Name is required");
      return;
    }

    setIsLoading(true);
    try {
      if (!forceProceed) {
        const simRes = await fetch(`${API_URL}/check-name`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ scheme_name: name }),
        });

        if (simRes.ok) {
          const data = await simRes.json();
          if (data.matches && data.matches.length > 0) {
            const isExact = data.matches.find((match: Match) => match.exact);
            if (isExact) {
              alert("Exact name already exists! Please choose another.");
              return;
            }

            setSimilarNames(data.matches);
            speakAndChat(
              "I found similar names in the database. Please review them before proceeding.",
              "!",
            );
            return;
          }
        }
      }

      const createRes = await fetch(`${API_URL}/step1`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scheme_name: name,
          scheme_type: type,
          current_status: status,
          estimated_cost: Number.parseFloat(estCost) || null,
        }),
      });

      if (!createRes.ok) {
        const err = await createRes.json();
        alert(`Backend Error: ${err.detail || "Could not create scheme"}`);
        return;
      }

      const newScheme = await createRes.json();
      setSchemeId(newScheme.id);
      setSimilarNames([]);
      setStep(2);
    } catch (error) {
      console.error("API Error:", error);
      alert(
        "Cannot reach the AI Brain! Ensure your FastAPI backend is running on port 8000.",
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleStep2Submit = async (skipped = false) => {
    setIsLoading(true);
    try {
      if (!skipped) {
        for (const field of mandatoryFields) {
          if (!dates[field]) {
            alert(`Please fill the mandatory field: ${field.replace(/_/g, " ")}`);
            return;
          }
        }
      }

      const payload = Object.fromEntries(
        Object.entries(dates).filter(([, value]) => value !== ""),
      );

      if (Object.keys(payload).length > 0 && schemeId) {
        const updateRes = await fetch(`${API_URL}/${schemeId}/step2`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        if (!updateRes.ok) {
          alert("Failed to save dates to database.");
          return;
        }
      }

      const parentRes = await fetch(`${API_URL}/parents?scheme_id=${schemeId}`);
      if (parentRes.ok) {
        const parentData = await parentRes.json();
        setAvailableParents(parentData);
      }

      setStep(3);
    } catch (error) {
      console.error("API Error:", error);
      alert("Failed to communicate with backend during Step 2.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleStep3Submit = async (skipped = false) => {
    setIsLoading(true);
    try {
      if (!skipped && parentId && schemeId) {
        const linkRes = await fetch(`${API_URL}/${schemeId}/step3`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ parent_id: Number.parseInt(parentId, 10) }),
        });

        if (!linkRes.ok) {
          alert("Failed to link to parent scheme.");
          return;
        }
      }

      alert("Scheme Registration Complete! Project Brain has logged the data.");
      window.location.href = "/view";
    } catch (error) {
      console.error("API Error:", error);
      alert("Failed to finalize scheme linkage.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="relative min-h-screen p-10 pt-20 text-[var(--ink)]">
      <div className="mx-auto mb-10 flex max-w-4xl flex-col justify-between gap-4 md:flex-row md:items-center">
        <h1 className="flex items-center gap-3 text-4xl font-bold tracking-tight text-[var(--ink)]">
          <span className="rounded-full border border-[var(--steel-dim)] bg-[var(--steel-soft)] px-4 py-1 text-lg text-[var(--steel)]">
            Step {step}/3
          </span>
          Scheme Registration
        </h1>

        <Link href="/add/bulk">
          <button className="flex items-center gap-2 rounded-xl border border-[var(--verdigris)] bg-[var(--verdigris-soft)] px-5 py-2.5 font-medium text-[var(--verdigris)] transition-all hover:scale-105 hover:brightness-[.98]">
            <UploadCloud size={20} />
            Bulk Upload (Excel)
          </button>
        </Link>
      </div>

      <div className="mx-auto max-w-4xl">
        <AnimatePresence mode="wait">
          {step === 1 && (
            <motion.div
              key="step1"
              initial={{ opacity: 0, x: 50 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -50 }}
              className={cardClass}
            >
              <h3 className="mb-6 border-b border-[var(--line)] pb-4 text-2xl font-semibold text-[var(--ink)]">
                Core Identity
              </h3>

              <div className="mb-6 grid grid-cols-2 gap-6">
                <div className="col-span-2">
                  <label className={labelClass}>
                    Scheme Name <span className="text-[var(--molten)]">*</span>
                  </label>
                  <input
                    type="text"
                    value={name}
                    onFocus={(e) =>
                      focusField(
                        e,
                        "The Scheme Name must be unique. I will scan the database when you continue, so be specific.",
                        ":)",
                      )
                    }
                    onChange={(event) => {
                      setName(event.target.value);
                      setSimilarNames([]);
                      setForceProceed(false);
                    }}
                    className={controlClass}
                    placeholder="BF #3 Modernization"
                  />
                </div>

                <div>
                  <label className={labelClass}>
                    Estimated Cost (Cr){" "}
                    <span className="italic text-[var(--ink-4)]">- Optional</span>
                  </label>
                  <input
                    type="number"
                    value={estCost}
                    onFocus={(e) =>
                      focusField(
                        e,
                        "What is the estimated cost? I will help you pick the right scheme type based on this.",
                        ":)",
                      )
                    }
                    onBlur={checkCostLogic}
                    onChange={(event) => setEstCost(event.target.value)}
                    className={controlClass}
                    placeholder="0.00"
                  />
                </div>

                <div>
                  <label className={labelClass}>Scheme Type</label>
                  <select
                    value={type}
                    onFocus={(e) =>
                      focusField(
                        e,
                        "Select the type. Did you see my recommendation?",
                        ":)",
                      )
                    }
                    onChange={(event) => setType(event.target.value as SchemeType)}
                    className={`${controlClass} cursor-pointer ${typeGlow}`}
                  >
                    <option value="corporate">Corporate AMR</option>
                    <option value="plant">Plant AMR</option>
                    <option value="dummy">Dummy / Internal</option>
                  </select>
                </div>

                <div className="col-span-2">
                  <label className={labelClass}>Current Status</label>
                  <select
                    value={status}
                    onFocus={(e) =>
                      focusField(
                        e,
                        "Please fill the scheme status carefully. This drives the workflow logic.",
                        "!",
                      )
                    }
                    onChange={(event) =>
                      setStatus(event.target.value as SchemeStatus)
                    }
                    className={`${controlClass} cursor-pointer`}
                  >
                    <option value="under_formulation">Under Formulation</option>
                    <option value="under_stage1">Under Stage-I</option>
                    <option value="under_tendering">Under Tendering</option>
                    <option value="under_stage2">Under Stage-II</option>
                    <option value="ongoing">Ongoing</option>
                    <option value="closed">Closed</option>
                  </select>
                </div>

                {similarNames.length > 0 && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    className="col-span-2 mt-2 rounded-xl border border-[var(--ember)] bg-[var(--ember-soft)] p-4"
                  >
                    <div className="mb-2 flex items-center gap-2 font-bold text-[var(--ember)]">
                      <AlertTriangle className="h-5 w-5" />
                      Similar Schemes Detected
                    </div>
                    <ul className="mb-4 space-y-1 text-sm text-[var(--ink-2)]">
                      {similarNames.map((scheme) => (
                        <li key={scheme.id}>
                          {scheme.name}{" "}
                          {scheme.confidence ? (
                            <span className="text-xs text-[var(--ember)]/80">
                              ({scheme.confidence}% match)
                            </span>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                    <label className="flex w-max cursor-pointer items-center gap-2 rounded-lg border border-[var(--line)] bg-[var(--panel)] p-3 text-sm text-[var(--ink)]">
                      <input
                        type="checkbox"
                        checked={forceProceed}
                        onChange={(event) =>
                          setForceProceed(event.target.checked)
                        }
                        className="h-4 w-4 accent-[var(--steel)]"
                      />
                      I confirm this is a new, unique scheme. Proceed anyway.
                    </label>
                  </motion.div>
                )}
              </div>

              <div className="mt-8 flex justify-end">
                <button
                  onClick={handleStep1Submit}
                  disabled={isLoading || (similarNames.length > 0 && !forceProceed)}
                  className="flex items-center gap-2 rounded-xl border border-[var(--steel-dim)] bg-[var(--steel)] px-8 py-4 font-bold text-white transition-colors hover:bg-[var(--steel-2)] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isLoading ? "Processing..." : "Create & Continue"}
                  <ArrowRight className="h-5 w-5" />
                </button>
              </div>
            </motion.div>
          )}

          {step === 2 && (
            <motion.div
              key="step2"
              initial={{ opacity: 0, x: 50 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -50 }}
              className={cardClass}
            >
              <div className="mb-6 flex items-center justify-between border-b border-[var(--line)] pb-4">
                <h3 className="text-2xl font-semibold text-[var(--ink)]">
                  Milestone Dates
                </h3>
              </div>

              <div className="mb-8 grid grid-cols-2 gap-6">
                {dateFields.map((field) => (
                  <div key={field.id}>
                    <label className="mb-2 flex items-center justify-between text-sm text-[var(--ink-3)]">
                      <span>
                        {field.label}{" "}
                        {isMandatory(field.id) && (
                          <span className="ml-1 text-[var(--steel)]">*</span>
                        )}
                      </span>
                    </label>
                    <input
                      type="date"
                      value={dates[field.id]}
                      onChange={(event) =>
                        setDates({ ...dates, [field.id]: event.target.value })
                      }
                      className={dateInputClass(field.id)}
                    />
                  </div>
                ))}

                <div className="col-span-2">
                  <label className={labelClass}>Remarks</label>
                  <textarea
                    rows={3}
                    value={dates.remarks}
                    onChange={(event) =>
                      setDates({ ...dates, remarks: event.target.value })
                    }
                    className={dateInputClass("remarks")}
                    placeholder="Add context, risks, or board notes"
                  />
                </div>
              </div>

              <div className="mt-8 flex justify-between border-t border-[var(--line)] pt-6">
                <button
                  onClick={() => handleStep2Submit(true)}
                  disabled={isLoading}
                  className="flex items-center gap-2 px-6 py-3 text-[var(--ink-3)] transition-colors hover:text-[var(--ink)]"
                >
                  <SkipForward className="h-5 w-5" />
                  Skip for now
                </button>
                <button
                  onClick={() => handleStep2Submit(false)}
                  disabled={isLoading}
                  className="flex items-center gap-2 rounded-xl border border-[var(--steel-dim)] bg-[var(--steel)] px-8 py-4 font-bold text-white transition-transform hover:scale-105 hover:bg-[var(--steel-2)]"
                >
                  <Save className="h-5 w-5" />
                  Save Dates & Continue
                </button>
              </div>
            </motion.div>
          )}

          {step === 3 && (
            <motion.div
              key="step3"
              initial={{ opacity: 0, x: 50 }}
              animate={{ opacity: 1, x: 0 }}
              className={cardClass}
            >
              <h3 className="mb-6 border-b border-[var(--line)] pb-4 text-2xl font-semibold text-[var(--ink)]">
                Package Linkage (Optional)
              </h3>
              <div className="mb-8">
                <label className={labelClass}>Select Master / Parent Scheme</label>
                <select
                  value={parentId}
                  onChange={(event) => setParentId(event.target.value)}
                  className={`${controlClass} cursor-pointer`}
                >
                  <option value="">-- No Parent (Standalone Scheme) --</option>
                  {availableParents.map((parent) => (
                    <option key={parent.id} value={parent.id}>
                      [{parent.id}] {parent.scheme_name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="mt-8 flex justify-between border-t border-[var(--line)] pt-6">
                <button
                  onClick={() => handleStep3Submit(true)}
                  disabled={isLoading}
                  className="flex items-center gap-2 px-6 py-3 text-[var(--ink-3)] transition-colors hover:text-[var(--ink)]"
                >
                  <CheckCircle className="h-5 w-5" />
                  Save as Standalone
                </button>
                <button
                  onClick={() => handleStep3Submit(false)}
                  disabled={isLoading || !parentId}
                  className="flex items-center gap-2 rounded-xl border border-[var(--verdigris)] bg-[var(--verdigris)] px-8 py-4 font-bold text-white transition-colors hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Save className="h-5 w-5" />
                  Link & Finalize
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
