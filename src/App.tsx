/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { GoogleGenAI, GenerateContentResponse } from "@google/genai";
import { 
  Github, 
  Sparkles, 
  Image as ImageIcon, 
  Video, 
  Download, 
  Settings, 
  ChevronRight,
  Lock,
  Globe,
  Loader2,
  Volume2,
  History,
  Clock,
  User as UserIcon,
  LogOut,
  Trash2,
  GripVertical,
  GripHorizontal,
  Maximize2,
  X
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { 
  auth, 
  db, 
  googleProvider, 
  signInWithPopup, 
  signOut, 
  onAuthStateChanged, 
  collection, 
  addDoc, 
  query, 
  where, 
  orderBy, 
  onSnapshot, 
  serverTimestamp, 
  limit,
  handleFirestoreError,
  OperationType
} from './firebase';
import type { User } from './firebase';

// --- Types ---
declare global {
  interface Window {
    aistudio?: {
      hasSelectedApiKey: () => Promise<boolean>;
      openSelectKey: () => Promise<void>;
    };
  }
}

interface RepoContext {
  repoName: string;
  owner: string;
  description: string;
  language: string;
  topics: string;
  filePaths: string[];
  readme: string;
}

interface ImageResult {
  base64: string;
  mimeType: string;
  prompt: string;
}

interface HistoryItem {
  id: string;
  prompt: string;
  negPrompt: string;
  fusedPrompt: string;
  repos: string[];
  model: string;
  aspectRatio: string;
  resolution: string;
  qualityPreset: string;
  lighting: string;
  renderStyle: string;
  images: { base64: string; mimeType: string }[];
  createdAt: any;
}

interface AppState {
  ghToken: string;
  ghUser: string;
  selectedRepos: { name: string; owner: string }[];
  repos: any[];
  artPrompt: string;
  negPrompt: string;
  model: string;
  aspectRatio: string;
  customRatio: { w: number; h: number };
  resolution: string;
  qualityPreset: string;
  lighting: string;
  renderStyle: string;
  count: number;
  isGenerating: boolean;
  isLoadingRepos: boolean;
  userImage: string | null;
  userImageMimeType: string | null;
  status: string;
  lastResults: ImageResult[];
  fusedPrompt: string;
}

// --- Constants ---
const MODELS = [
  { id: 'gemini-2.5-flash-image', name: 'Nano Banana', desc: 'Fast · Gemini 2.5 Flash' },
  { id: 'gemini-3.1-flash-image-preview', name: 'Nano Banana 2 ★', desc: 'Speed + Quality · Gemini 3.1 Flash' },
  { id: 'gemini-3-pro-image-preview', name: 'Nano Banana Pro', desc: 'Max Fidelity · Gemini 3 Pro' },
];

const RATIOS = [
  { id: '1:1', label: '1:1' },
  { id: '4:3', label: '4:3' },
  { id: '3:2', label: '3:2' },
  { id: '16:9', label: '16:9' },
  { id: '21:9', label: '21:9' },
  { id: '2:3', label: '2:3' },
  { id: '9:16', label: '9:16' },
  { id: 'custom', label: '✏ custom' },
];

const RESOLUTIONS = [
  { id: '512px', label: '512' },
  { id: '768px', label: '768' },
  { id: '1024px', label: '1K' },
  { id: '2048px', label: '2K' },
  { id: '4096px', label: '4K' },
];

// --- Helpers ---
const GH_API = 'https://api.github.com';

async function getRepos(token: string, username: string) {
  const res = await fetch(
    `${GH_API}/users/${username}/repos?per_page=100&sort=updated`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) throw new Error(`GitHub error ${res.status}: check token + username`);
  return res.json();
}

async function getRepoContext(token: string, owner: string, repo: string): Promise<RepoContext> {
  const headers = { Authorization: `Bearer ${token}` };
  
  // Fetch tree, metadata, and readme in parallel
  const [treeRes, metaRes, readmeRes] = await Promise.all([
    fetch(`${GH_API}/repos/${owner}/${repo}/git/trees/HEAD?recursive=1`, { headers }),
    fetch(`${GH_API}/repos/${owner}/${repo}`, { headers }),
    fetch(`${GH_API}/repos/${owner}/${repo}/readme`, { headers }).catch(() => null)
  ]);

  if (!treeRes.ok) throw new Error(`Failed to fetch repo tree: ${treeRes.status}`);
  if (!metaRes.ok) throw new Error(`Failed to fetch repo metadata: ${metaRes.status}`);

  const [treeData, meta] = await Promise.all([
    treeRes.json(),
    metaRes.json()
  ]);

  let readme = '';
  if (readmeRes && readmeRes.ok) {
    try {
      const rData = await readmeRes.json();
      readme = atob(rData.content.replace(/\n/g, '')).slice(0, 2500);
    } catch (_) {}
  }

  const filePaths = (treeData.tree || [])
    .filter((f: any) => f.type === 'blob')
    .map((f: any) => f.path)
    .slice(0, 100);

  return {
    repoName: repo,
    owner,
    description: meta.description || '',
    language: meta.language || '',
    topics: (meta.topics || []).join(', '),
    filePaths,
    readme,
  };
}

export default function App() {
  const [activeTab, setActiveTab] = useState<'controls' | 'results'>('controls');
  const [state, setState] = useState<AppState>({
    ghToken: import.meta.env.VITE_GITHUB_TOKEN || '',
    ghUser: 'merrypranxter',
    selectedRepos: [],
    repos: [],
    artPrompt: '',
    negPrompt: '',
    model: 'gemini-3.1-flash-image-preview',
    aspectRatio: '1:1',
    customRatio: { w: 3, h: 4 },
    resolution: '1024px',
    qualityPreset: '',
    lighting: '',
    renderStyle: '',
    count: 1,
    isGenerating: false,
    isLoadingRepos: false,
    userImage: null,
    userImageMimeType: null,
    status: '',
    lastResults: [],
    fusedPrompt: '',
  });

  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [isAuthOpen, setIsAuthOpen] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [selectedImage, setSelectedImage] = useState<ImageResult | null>(null);

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsHistoryOpen(false);
        setSelectedImage(null);
      }
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) {
      setHistory([]);
      return;
    }

    const q = query(
      collection(db, 'renders'),
      where('userId', '==', user.uid),
      orderBy('createdAt', 'desc'),
      limit(50)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const items: HistoryItem[] = [];
      snapshot.forEach((doc) => {
        items.push({ id: doc.id, ...doc.data() } as HistoryItem);
      });
      setHistory(items);
    }, (error) => {
      // Only handle if it's a permission error, otherwise it might be initial load
      if (error.message.includes('permission-denied')) {
        handleFirestoreError(error, OperationType.LIST, 'renders');
      }
    });

    return () => unsubscribe();
  }, [user]);

  useEffect(() => {
    const checkKey = async () => {
      if (window.aistudio?.hasSelectedApiKey) {
        const selected = await window.aistudio.hasSelectedApiKey();
        setHasKey(selected);
      } else {
        setHasKey(true);
      }
    };
    checkKey();
  }, []);

  const handleSelectKey = async () => {
    if (window.aistudio?.openSelectKey) {
      await window.aistudio.openSelectKey();
      setHasKey(true);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      setIsAuthOpen(false);
    } catch (error) {
      console.error("Logout failed", error);
    }
  };

  const handleLogin = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
      setIsAuthOpen(false);
    } catch (error) {
      console.error("Login failed", error);
    }
  };

  const handleLoadRepos = async () => {
    if (!state.ghToken || !state.ghUser) {
      setState(s => ({ ...s, status: 'Error: Need both token and username' }));
      return;
    }
    setState(s => ({ ...s, isLoadingRepos: true, status: 'loading repos...' }));
    try {
      const repos = await getRepos(state.ghToken, state.ghUser);
      setState(s => ({ ...s, repos, isLoadingRepos: false, status: `${repos.length} repos loaded` }));
    } catch (e: any) {
      setState(s => ({ ...s, isLoadingRepos: false, status: `Error: ${e.message}` }));
    }
  };

  const handleAddRepo = (repoName: string) => {
    if (!repoName) return;
    const repo = state.repos.find(r => r.name === repoName);
    if (!repo) return;
    
    const owner = repo.owner?.login || state.ghUser;
    if (state.selectedRepos.find(r => r.name === repoName && r.owner === owner)) return;

    setState(s => ({
      ...s,
      selectedRepos: [...s.selectedRepos, { name: repoName, owner }]
    }));
  };

  const handleRemoveRepo = (index: number) => {
    setState(s => ({
      ...s,
      selectedRepos: s.selectedRepos.filter((_, i) => i !== index)
    }));
  };

  const handleGenerate = async () => {
    if (!state.artPrompt) {
      setState(s => ({ ...s, status: 'Error: Write an art prompt first' }));
      return;
    }

    if (state.selectedRepos.length === 0) {
      setState(s => ({ ...s, status: 'Error: Add at least one repo to the mix' }));
      return;
    }

    // Check for key if using a paid model
    const isPaidModel = state.model.includes('gemini-3');
    if (isPaidModel && window.aistudio?.hasSelectedApiKey) {
      const selected = await window.aistudio.hasSelectedApiKey();
      if (!selected) {
        setState(s => ({ ...s, status: 'Error: Please select a paid API key' }));
        if (window.aistudio?.openSelectKey) {
          await window.aistudio.openSelectKey();
        }
        return;
      }
    }

    setState(s => ({ ...s, isGenerating: true, status: 'reading repo...', lastResults: [] }));

    const callWithRetry = async (fn: () => Promise<any>, maxRetries = 3) => {
      let lastError: any;
      for (let i = 0; i < maxRetries; i++) {
        try {
          return await fn();
        } catch (e: any) {
          lastError = e;
          const isRetryable = e.message?.includes('503') || e.message?.includes('high demand') || e.message?.includes('UNAVAILABLE');
          if (isRetryable && i < maxRetries - 1) {
            const delay = Math.pow(2, i) * 1000 + Math.random() * 1000;
            setState(s => ({ ...s, status: `Busy... retrying in ${Math.round(delay/1000)}s (attempt ${i + 1}/${maxRetries})` }));
            await new Promise(resolve => setTimeout(resolve, delay));
            continue;
          }
          throw e;
        }
      }
      throw lastError;
    };

    try {
      // Create fresh instance before calls
      // Use process.env.API_KEY if available (injected from key selection dialog)
      const apiKey = process.env.API_KEY || process.env.GEMINI_API_KEY;
      const ai = new GoogleGenAI({ apiKey });

      // Step 1: Repo Contexts
      setState(s => ({ ...s, status: `reading ${state.selectedRepos.length} repo(s)...` }));
      const repoContexts = await Promise.all(
        state.selectedRepos.map(r => getRepoContext(state.ghToken, r.owner, r.name))
      );
      
      // Step 2: Gemini Vibe Fusion
      setState(s => ({ ...s, status: 'fusing prompt with repo DNA...' }));
      
      const systemPrompt = `
        You are a visual art director who reads code repositories and translates their essence into rich, specific image generation prompts.
        Given metadata, file structures, and READMEs from one or more repositories, extract:
        - The domain/purpose of each (what does this code DO?)
        - Dominant aesthetic signals (scientific? creative? data-heavy? generative?)
        - Key concepts, metaphors, visual motifs from the repos
        - The overall "energy" and feel
        
        If multiple repos are provided, FUSE their vibes together. 
        For example, if one is about "Lovecraftian OS" and another is "Garbage Enlightenment Style", 
        the result should be a Lovecraftian operating system rendered in a Garbage Enlightenment aesthetic.
        
        Fuse this with the user's art direction to produce ONE cohesive, maximalist, visually specific image generation prompt.
        Return ONLY the fused image prompt. No preamble. No explanation.
      `.trim();

      const reposInfo = repoContexts.map((ctx, i) => `
        REPO ${i + 1}: ${ctx.owner}/${ctx.repoName}
        DESCRIPTION: ${ctx.description}
        PRIMARY LANGUAGE: ${ctx.language}
        TOPICS: ${ctx.topics}
        FILE TREE (excerpt):
        ${ctx.filePaths.slice(0, 20).join('\n')}
        README EXCERPT:
        ${ctx.readme || '[no README]'}
      `).join('\n---\n');

      const userMsg = `
        REPOS IN THE MIX:
        ${reposInfo}
        
        USER ART DIRECTION:
        ${state.artPrompt}
        
        Generate the fused visual prompt now.
      `.trim();

      const vibeResponse = await callWithRetry(() => ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: userMsg,
        config: {
          systemInstruction: systemPrompt,
          temperature: 1.0,
        }
      }));

      const fusedPrompt = vibeResponse.text?.trim() || '';
      setState(s => ({ ...s, fusedPrompt }));

      // Step 3: Image Generation
      setState(s => ({ ...s, status: `generating ${state.count} image${state.count > 1 ? 's' : ''}...` }));
      
      const actualRatio = state.aspectRatio === 'custom' ? `${state.customRatio.w}:${state.customRatio.h}` : state.aspectRatio;
      
      const modifiers = [
        actualRatio ? `${actualRatio} aspect ratio` : '',
        state.resolution ? `${state.resolution} resolution` : '',
        state.qualityPreset,
        state.lighting,
        state.renderStyle,
        state.negPrompt ? `Avoid: ${state.negPrompt}` : '',
      ].filter(Boolean).join(', ');

      const fullPrompt = `${fusedPrompt}. ${modifiers}`;
      
      const results: ImageResult[] = [];
      for (let i = 0; i < state.count; i++) {
        const parts: any[] = [];
        if (state.userImage && state.userImageMimeType) {
          parts.push({
            inlineData: {
              data: state.userImage,
              mimeType: state.userImageMimeType
            }
          });
        }
        parts.push({ text: fullPrompt });

        const isNanoBananaSeries = state.model.includes('image');
        const config: any = {
          temperature: 1.0,
        };

        if (isNanoBananaSeries) {
          config.imageConfig = {
            aspectRatio: actualRatio,
            imageSize: state.resolution === '2048px' ? '2K' : (state.resolution === '1024px' ? '1K' : '512px')
          };
        } else {
          config.responseModalities = ['IMAGE'];
        }

        const response = await callWithRetry(() => ai.models.generateContent({
          model: state.model,
          contents: { parts },
          config
        }));

        const imgPart = response.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData);
        if (imgPart?.inlineData) {
          results.push({
            base64: imgPart.inlineData.data,
            mimeType: imgPart.inlineData.mimeType || 'image/png',
            prompt: fullPrompt,
          });
        }
      }

      setState(s => ({ 
        ...s, 
        lastResults: results, 
        isGenerating: false, 
        status: `✓ done — ${results.length} image${results.length > 1 ? 's' : ''} generated` 
      }));

      // Save to History if logged in
      if (user) {
        try {
          await addDoc(collection(db, 'renders'), {
            userId: user.uid,
            prompt: state.artPrompt,
            negPrompt: state.negPrompt,
            fusedPrompt: fusedPrompt,
            repos: state.selectedRepos.map(r => r.name),
            model: state.model,
            aspectRatio: state.aspectRatio,
            resolution: state.resolution,
            qualityPreset: state.qualityPreset,
            lighting: state.lighting,
            renderStyle: state.renderStyle,
            images: results.map(r => ({ base64: r.base64, mimeType: r.mimeType })),
            createdAt: serverTimestamp()
          });
        } catch (error) {
          console.error("Failed to save to history", error);
        }
      }

    } catch (e: any) {
      if (e.message?.includes('PERMISSION_DENIED') || e.message?.includes('not have permission')) {
        setState(s => ({ ...s, isGenerating: false, status: 'Error: Permission Denied. Please select a paid API key.' }));
        if (window.aistudio?.openSelectKey) {
          window.aistudio.openSelectKey();
        }
      } else {
        setState(s => ({ ...s, isGenerating: false, status: `Error: ${e.message}` }));
      }
      console.error(e);
    }
  };

  const handleExport = (img: ImageResult, index: number) => {
    const canvas = document.createElement('canvas');
    const image = new Image();
    image.onload = () => {
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const ctx = canvas.getContext('2d');
      ctx?.drawImage(image, 0, 0);
      canvas.toBlob(blob => {
        if (blob) {
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
          a.href = url;
          a.download = `repoalchemist_${state.selectedRepos.map(r => r.name).join('_')}_${index + 1}_${ts}.png`;
          a.click();
          URL.revokeObjectURL(url);
        }
      }, 'image/png');
    };
    image.src = `data:${img.mimeType};base64,${img.base64}`;
  };

  const handleSpeak = () => {
    if (!state.fusedPrompt) return;
    const utter = new SpeechSynthesisUtterance(state.fusedPrompt);
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utter);
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64String = (reader.result as string).split(',')[1];
        setState(s => ({ ...s, userImage: base64String, userImageMimeType: file.type }));
      };
      reader.readAsDataURL(file);
    }
  };

  return (
    <div className="flex flex-col h-screen bg-bg text-text font-sans overflow-hidden">
      {/* Header */}
      <header className="flex flex-col sm:flex-row justify-between items-center px-4 sm:px-6 py-3 sm:py-4 border-b border-border shrink-0 gap-3">
        <div className="flex flex-col items-center sm:items-start text-center sm:text-left">
          <h1 className="text-lg sm:text-xl tracking-[0.15em] text-accent2 font-bold flex items-center gap-2">
            <span className="text-xl sm:text-2xl">⬡</span> REPO ALCHEMIST
          </h1>
          <p className="text-[0.6rem] sm:text-[0.7rem] text-muted tracking-[0.18em] uppercase">repo → vibe → nano banana → art</p>
        </div>

        {/* Mobile Tab Switcher */}
        <div className="flex md:hidden border border-border rounded-sm overflow-hidden">
          <button 
            onClick={() => setActiveTab('controls')}
            className={`px-4 py-1.5 text-[0.65rem] font-mono uppercase transition-colors ${activeTab === 'controls' ? 'bg-accent text-bg' : 'bg-panel2 text-muted'}`}
          >
            Input
          </button>
          <button 
            onClick={() => setActiveTab('results')}
            className={`px-4 py-1.5 text-[0.65rem] font-mono uppercase transition-colors ${activeTab === 'results' ? 'bg-accent text-bg' : 'bg-panel2 text-muted'}`}
          >
            Output
          </button>
        </div>

        <div className="flex items-center gap-3 sm:gap-4 relative">
          {/* History Button */}
          <button 
            onClick={() => setIsHistoryOpen(!isHistoryOpen)}
            className={`p-2 rounded-full transition-colors ${isHistoryOpen ? 'bg-accent text-bg' : 'text-muted hover:text-accent'}`}
            title="History"
          >
            <History className="w-5 h-5" />
          </button>

          <div className="relative">
            <button 
              onClick={() => setIsAuthOpen(!isAuthOpen)}
              className={`text-[0.65rem] tracking-[0.12em] px-3 py-1 uppercase font-bold transition-colors flex items-center gap-1.5 ${state.repos.length > 0 ? 'bg-panel2 text-accent2 border border-accent2' : 'bg-accent text-bg'}`}
            >
              {user ? (
                <>
                  <img src={user.photoURL || ''} className="w-4 h-4 rounded-full" referrerPolicy="no-referrer" />
                  <span className="max-w-[80px] truncate">{user.displayName?.split(' ')[0]}</span>
                </>
              ) : (
                <>
                  <Github className="w-3 h-3" />
                  {state.repos.length > 0 ? 'GH: Connected' : 'Connect GitHub'}
                </>
              )}
            </button>

            <AnimatePresence>
              {isAuthOpen && (
                <motion.div 
                  initial={{ opacity: 0, y: 10, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 10, scale: 0.95 }}
                  className="absolute right-0 mt-2 w-72 bg-panel border border-border shadow-2xl z-50 p-4 rounded-sm"
                >
                  {user ? (
                    <div className="flex flex-col gap-4">
                      <div className="flex items-center gap-3 border-b border-border pb-3">
                        <img src={user.photoURL || ''} className="w-10 h-10 rounded-full" referrerPolicy="no-referrer" />
                        <div className="flex flex-col">
                          <div className="text-[0.7rem] font-bold text-text">{user.displayName}</div>
                          <div className="text-[0.6rem] text-muted truncate max-w-[150px]">{user.email}</div>
                        </div>
                      </div>
                      
                      <div className="text-[0.65rem] font-mono uppercase text-muted tracking-widest border-b border-border pb-1">GitHub Settings</div>
                      <div className="flex flex-col gap-3">
                        <div>
                          <label className="text-[0.6rem] uppercase tracking-wider text-muted mb-1 block">Personal Access Token</label>
                          <input 
                            type="password" 
                            placeholder="ghp_xxxxxxxxxxxx" 
                            className="w-full text-[0.7rem] bg-bg border-border focus:border-accent"
                            value={state.ghToken}
                            onChange={e => setState(s => ({ ...s, ghToken: e.target.value }))}
                          />
                        </div>
                        <div>
                          <label className="text-[0.6rem] uppercase tracking-wider text-muted mb-1 block">Username</label>
                          <div className="flex gap-2">
                            <input 
                              type="text" 
                              placeholder="username" 
                              className="flex-1 text-[0.7rem] bg-bg border-border focus:border-accent"
                              value={state.ghUser}
                              onChange={e => setState(s => ({ ...s, ghUser: e.target.value }))}
                            />
                            <button 
                              onClick={() => {
                                handleLoadRepos();
                                setIsAuthOpen(false);
                              }}
                              disabled={state.isLoadingRepos}
                              className="bg-accent text-bg text-[0.65rem] px-3 py-1 uppercase font-bold hover:bg-white transition-colors disabled:opacity-50"
                            >
                              {state.isLoadingRepos ? <Loader2 className="animate-spin w-3 h-3" /> : 'Load'}
                            </button>
                          </div>
                        </div>
                      </div>

                      <button 
                        onClick={handleLogout}
                        className="mt-2 flex items-center justify-center gap-2 text-[0.65rem] uppercase font-bold text-accent3 hover:text-white transition-colors border border-accent3/20 py-2"
                      >
                        <LogOut className="w-3 h-3" /> Sign Out
                      </button>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-4">
                      <div className="text-[0.65rem] font-mono uppercase text-muted mb-1 tracking-widest border-b border-border pb-1">Sign In</div>
                      <p className="text-[0.6rem] text-muted leading-tight">
                        Sign in with Google to save your render history and repository mixes.
                      </p>
                      <button 
                        onClick={handleLogin}
                        className="bg-accent text-bg text-[0.7rem] py-2 uppercase font-bold flex items-center justify-center gap-2 hover:bg-white transition-colors"
                      >
                        <UserIcon className="w-4 h-4" /> Sign in with Google
                      </button>
                      
                      <div className="text-[0.65rem] font-mono uppercase text-muted mt-2 tracking-widest border-b border-border pb-1">Guest GitHub Settings</div>
                      <div className="flex flex-col gap-3">
                        <div>
                          <label className="text-[0.6rem] uppercase tracking-wider text-muted mb-1 block">Personal Access Token</label>
                          <input 
                            type="password" 
                            placeholder="ghp_xxxxxxxxxxxx" 
                            className="w-full text-[0.7rem] bg-bg border-border focus:border-accent"
                            value={state.ghToken}
                            onChange={e => setState(s => ({ ...s, ghToken: e.target.value }))}
                          />
                        </div>
                        <div>
                          <label className="text-[0.6rem] uppercase tracking-wider text-muted mb-1 block">Username</label>
                          <div className="flex gap-2">
                            <input 
                              type="text" 
                              placeholder="username" 
                              className="flex-1 text-[0.7rem] bg-bg border-border focus:border-accent"
                              value={state.ghUser}
                              onChange={e => setState(s => ({ ...s, ghUser: e.target.value }))}
                            />
                            <button 
                              onClick={() => {
                                handleLoadRepos();
                                setIsAuthOpen(false);
                              }}
                              disabled={state.isLoadingRepos}
                              className="bg-accent text-bg text-[0.65rem] px-3 py-1 uppercase font-bold hover:bg-white transition-colors disabled:opacity-50"
                            >
                              {state.isLoadingRepos ? <Loader2 className="animate-spin w-3 h-3" /> : 'Load'}
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {hasKey === false && (
            <button 
              onClick={handleSelectKey}
              className="text-[0.65rem] tracking-[0.12em] bg-accent2 text-bg px-3 py-1 uppercase font-bold hover:bg-white transition-colors"
            >
              Select API Key
            </button>
          )}
          <span className="hidden sm:inline text-[0.65rem] tracking-[0.12em] text-accent border border-accent px-3 py-1 uppercase">
            {MODELS.find(m => m.id === state.model)?.name || 'no model selected'}
          </span>
        </div>
      </header>

      <div className="flex flex-col md:flex-row flex-1 overflow-hidden min-h-0">
        <AnimatePresence>
          {selectedImage && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[100] bg-bg/95 backdrop-blur-sm flex items-center justify-center p-4 md:p-12"
              onClick={() => setSelectedImage(null)}
            >
              <button 
                className="absolute top-6 right-6 text-muted hover:text-accent transition-colors z-[110]"
                onClick={() => setSelectedImage(null)}
              >
                <X className="w-8 h-8" />
              </button>
              
              <motion.div 
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.9, opacity: 0 }}
                className="relative max-w-full max-h-full flex flex-col items-center"
                onClick={e => e.stopPropagation()}
              >
                <img 
                  src={`data:${selectedImage.mimeType};base64,${selectedImage.base64}`} 
                  alt="Full view" 
                  className="max-w-full max-h-[85vh] object-contain shadow-2xl border border-border/50"
                  referrerPolicy="no-referrer"
                />
                <div className="mt-6 text-center max-w-2xl px-4">
                  <p className="text-[0.7rem] text-muted uppercase tracking-[0.2em] mb-2">Fused Prompt DNA</p>
                  <p className="text-[0.8rem] text-text/80 leading-relaxed italic">"{selectedImage.prompt}"</p>
                  <button 
                    onClick={() => handleExport(selectedImage, 0)}
                    className="mt-6 bg-accent text-bg px-6 py-2 text-[0.75rem] font-bold uppercase tracking-widest hover:bg-white transition-colors flex items-center gap-2 mx-auto"
                  >
                    <Download className="w-4 h-4" /> Download PNG
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        <PanelGroup direction="horizontal" className="flex-1">
          {/* Left Panel: Controls */}
          <Panel 
            defaultSize={25} 
            minSize={20} 
            maxSize={40}
            className={`${activeTab === 'controls' ? 'flex' : 'hidden'} md:flex border-b md:border-b-0 md:border-r border-border flex-col bg-panel min-h-0`}
          >
            <div className="flex-1 overflow-y-auto custom-scrollbar min-h-0 touch-pan-y">
              {/* Repo Section */}
              <section className="control-section">
                <div className="section-label flex items-center justify-between">
                  <div className="flex items-center gap-1">🧪 THE MIX</div>
                  {state.selectedRepos.length > 0 && (
                    <button 
                      onClick={() => setState(s => ({ ...s, selectedRepos: [] }))}
                      className="text-[0.6rem] text-muted hover:text-accent3 uppercase tracking-wider"
                    >
                      Clear All
                    </button>
                  )}
                </div>
                <div className="flex flex-col gap-1.5 mt-2">
                  {state.selectedRepos.length === 0 ? (
                    <div className="text-[0.65rem] text-muted italic border border-dashed border-border p-3 text-center rounded-sm">
                      No repos added. Pick one below to start the alchemy.
                    </div>
                  ) : (
                    state.selectedRepos.map((repo, idx) => (
                      <div key={`${repo.owner}-${repo.name}-${idx}`} className="flex items-center justify-between bg-panel2 border border-border px-2 py-1.5 rounded-sm text-[0.7rem] group">
                        <span className="truncate flex-1">
                          <span className="text-muted opacity-50">{repo.owner}/</span>
                          <span className="font-bold text-accent2">{repo.name}</span>
                        </span>
                        <button 
                          onClick={() => handleRemoveRepo(idx)}
                          className="ml-2 text-muted opacity-0 group-hover:opacity-100 hover:text-accent3 transition-all"
                        >
                          ✕
                        </button>
                      </div>
                    ))
                  )}
                </div>

                <div className="mt-3">
                  <select 
                    disabled={state.repos.length === 0}
                    className="w-full bg-bg border-accent/30 focus:border-accent text-[0.7rem]"
                    value=""
                    onChange={e => handleAddRepo(e.target.value)}
                  >
                    <option value="">+ ADD REPO TO MIX</option>
                    {state.repos.map(repo => (
                      <option key={repo.id} value={repo.name}>
                        {repo.name} {repo.private ? '🔒' : ''}
                      </option>
                    ))}
                  </select>
                </div>
              </section>

              {/* Prompt Section */}
              <section className="control-section">
                <div className="section-label flex items-center gap-1">✏️ PROMPT</div>
                
                <label>Reference Image (Optional)</label>
                <div className="flex flex-col gap-2 mt-1">
                  <input 
                    type="file" 
                    accept="image/*"
                    onChange={handleImageUpload}
                    className="text-[0.65rem] file:bg-panel2 file:border-border file:text-text file:px-2 file:py-1 file:mr-2 file:cursor-pointer hover:file:border-accent2"
                  />
                  {state.userImage && (
                    <div className="relative w-full aspect-video bg-panel2 border border-border overflow-hidden">
                      <img 
                        src={`data:${state.userImageMimeType};base64,${state.userImage}`} 
                        alt="Reference" 
                        className="w-full h-full object-contain"
                      />
                      <button 
                        onClick={() => setState(s => ({ ...s, userImage: null, userImageMimeType: null }))}
                        className="absolute top-1 right-1 bg-bg/80 text-text p-1 text-[0.6rem] hover:text-accent3"
                      >
                        ✕
                      </button>
                    </div>
                  )}
                </div>

                <label className="mt-2">Art Direction</label>
                <textarea 
                  rows={4}
                  placeholder="bioluminescent fractal network, deep space, maximalist, glitch..."
                  value={state.artPrompt}
                  onChange={e => setState(s => ({ ...s, artPrompt: e.target.value }))}
                />
                <label>Negative Prompt</label>
                <textarea 
                  rows={2}
                  placeholder="blur, watermark, text, low quality, ugly..."
                  value={state.negPrompt}
                  onChange={e => setState(s => ({ ...s, negPrompt: e.target.value }))}
                />
              </section>

              {/* Model Section */}
              <section className="control-section">
                <div className="section-label flex items-center gap-1">🍌 MODEL</div>
                <div className="flex flex-col gap-2">
                  {MODELS.map(m => (
                    <div 
                      key={m.id}
                      onClick={() => setState(s => ({ ...s, model: m.id }))}
                      className={`model-card ${state.model === m.id ? 'selected' : ''}`}
                    >
                      <div className="text-[0.8rem] font-bold">{m.name}</div>
                      <div className="text-[0.65rem] text-muted mt-0.5">{m.desc}</div>
                    </div>
                  ))}
                </div>
              </section>

              {/* Size & Ratio Section */}
              <section className="control-section">
                <div className="section-label flex items-center gap-1">📐 SIZE & RATIO</div>
                <label>Aspect Ratio</label>
                <div className="grid grid-cols-4 gap-1.5">
                  {RATIOS.map(r => (
                    <button 
                      key={r.id}
                      onClick={() => setState(s => ({ ...s, aspectRatio: r.id }))}
                      className={`ratio-btn ${state.aspectRatio === r.id ? 'selected' : ''}`}
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
                {state.aspectRatio === 'custom' && (
                  <div className="flex items-center gap-2 mt-2">
                    <input 
                      type="number" 
                      className="w-16 text-center"
                      value={state.customRatio.w}
                      onChange={e => setState(s => ({ ...s, customRatio: { ...s.customRatio, w: parseInt(e.target.value) || 1 } }))}
                    />
                    <span className="text-muted">:</span>
                    <input 
                      type="number" 
                      className="w-16 text-center"
                      value={state.customRatio.h}
                      onChange={e => setState(s => ({ ...s, customRatio: { ...s.customRatio, h: parseInt(e.target.value) || 1 } }))}
                    />
                  </div>
                )}
                <label className="mt-4">Resolution Target</label>
                <div className="grid grid-cols-5 gap-1.5">
                  {RESOLUTIONS.map(res => (
                    <button 
                      key={res.id}
                      onClick={() => setState(s => ({ ...s, resolution: res.id }))}
                      className={`res-btn ${state.resolution === res.id ? 'selected' : ''}`}
                    >
                      {res.label}
                    </button>
                  ))}
                </div>
              </section>

              {/* Style Modifiers Section */}
              <section className="control-section">
                <div className="section-label flex items-center gap-1">🎨 STYLE MODIFIERS</div>
                <label>Quality Preset</label>
                <select value={state.qualityPreset} onChange={e => setState(s => ({ ...s, qualityPreset: e.target.value }))}>
                  <option value="">— none —</option>
                  <option value="ultra high detail, photorealistic, 8K textures, cinematic lighting">Photorealistic</option>
                  <option value="painterly, expressive brushwork, fine art, museum quality">Fine Art</option>
                  <option value="maximalist, neon, glitch artifacts, chromatic aberration, cyberpunk">Glitch / Cyber</option>
                  <option value="generative art, mathematical precision, fractal geometry, data visualization">Generative / Math</option>
                  <option value="bioluminescent, subsurface scattering, volumetric light, deep sea">Bioluminescent</option>
                  <option value="studio photography, clean background, product shot, sharp focus">Studio / Commercial</option>
                  <option value="anime, manga, ink outline, flat color, cel shading">Anime / Illustrated</option>
                  <option value="vintage film, grain, halation, muted palette, nostalgic">Film / Analog</option>
                  <option value="minimalist, clean, swiss design, typography-forward, geometric">Minimal / Graphic</option>
                </select>
                <label>Lighting</label>
                <select value={state.lighting} onChange={e => setState(s => ({ ...s, lighting: e.target.value }))}>
                  <option value="">— none —</option>
                  <option value="dramatic chiaroscuro lighting, deep shadows">Chiaroscuro</option>
                  <option value="soft diffuse studio lighting, even exposure">Soft Studio</option>
                  <option value="golden hour, warm sunlight, long shadows">Golden Hour</option>
                  <option value="neon glow, colored rim lighting, dark background">Neon Rim</option>
                  <option value="volumetric god rays, atmospheric haze, backlit">Volumetric</option>
                  <option value="flat harsh fluorescent lighting, clinical">Harsh Fluorescent</option>
                  <option value="bioluminescent glow, deep black background">Bio Glow</option>
                </select>
                <label>Rendering Style</label>
                <select value={state.renderStyle} onChange={e => setState(s => ({ ...s, renderStyle: e.target.value }))}>
                  <option value="">— none —</option>
                  <option value="hyper-detailed 3D render, octane renderer, physically based materials">3D / Octane</option>
                  <option value="2D illustration, vector art, flat design">2D Illustration</option>
                  <option value="isometric 3D, low-poly, clean geometry">Isometric</option>
                  <option value="photo-real, DSLR, 85mm lens, shallow depth of field">DSLR Photo</option>
                  <option value="watercolor wash, paper texture, soft edges">Watercolor</option>
                  <option value="oil painting, thick impasto, textured canvas">Oil Painting</option>
                  <option value="pencil sketch, cross-hatching, graphite on paper">Sketch</option>
                </select>
                <label>Output Count</label>
                <div className="flex gap-2">
                  {[1, 2, 3, 4].map(n => (
                    <button 
                      key={n}
                      onClick={() => setState(s => ({ ...s, count: n }))}
                      className={`count-btn flex-1 ${state.count === n ? 'selected' : ''}`}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </section>
            </div>

            {/* Generate Section */}
            <section className="control-section border-t border-border bg-panel2 shrink-0">
              <button 
                id="generate-btn"
                disabled={state.isGenerating || state.selectedRepos.length === 0}
                onClick={handleGenerate}
                className="primary flex items-center justify-center gap-2"
              >
                {state.isGenerating ? <Loader2 className="animate-spin w-5 h-5" /> : '⚡'} GENERATE
              </button>
              <div id="status-line" className="text-[0.7rem] text-accent2 tracking-[0.1em] min-h-[1.2em] text-center mt-2">
                {state.status}
              </div>
            </section>
          </Panel>

          <PanelResizeHandle className="hidden md:flex w-1 bg-border hover:bg-accent transition-colors cursor-col-resize items-center justify-center group">
            <div className="w-px h-8 bg-muted/30 group-hover:bg-accent2/50" />
            <GripVertical className="w-3 h-3 text-muted/30 group-hover:text-accent2 absolute" />
          </PanelResizeHandle>

          {/* Right Panel: Output */}
          <Panel 
            defaultSize={75}
            className={`${activeTab === 'results' ? 'flex' : 'hidden'} md:flex flex-1 flex flex-col overflow-hidden bg-bg relative`}
          >
            {/* History Overlay */}
            <AnimatePresence>
              {isHistoryOpen && (
                <motion.div 
                  initial={{ opacity: 0, x: 300 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 300 }}
                  className="absolute inset-0 z-40 bg-panel border-l border-border flex flex-col shadow-2xl"
                >
                  <div className="p-6 border-b border-border flex items-center justify-between bg-panel2">
                    <div className="flex items-center gap-3">
                      <History className="w-5 h-5 text-accent" />
                      <h2 className="text-[0.8rem] font-bold tracking-[0.2em] uppercase">Alchemy History</h2>
                    </div>
                    <button 
                      onClick={() => setIsHistoryOpen(false)}
                      className="text-muted hover:text-accent transition-colors text-[0.7rem] uppercase tracking-widest"
                    >
                      Close [esc]
                    </button>
                  </div>

                  <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">
                    {!user ? (
                      <div className="h-full flex flex-col items-center justify-center text-center gap-4 opacity-50">
                        <Lock className="w-12 h-12" />
                        <div>
                          <p className="text-[0.75rem] font-bold uppercase tracking-widest mb-1">History Locked</p>
                          <p className="text-[0.65rem] max-w-[200px]">Sign in to persist your renders across sessions.</p>
                        </div>
                        <button 
                          onClick={handleLogin}
                          className="bg-accent text-bg text-[0.7rem] px-6 py-2 uppercase font-bold hover:bg-white transition-colors mt-2"
                        >
                          Sign In
                        </button>
                      </div>
                    ) : history.length === 0 ? (
                      <div className="h-full flex flex-col items-center justify-center text-center gap-4 opacity-30">
                        <Clock className="w-12 h-12" />
                        <p className="text-[0.75rem] font-bold uppercase tracking-widest">No Renders Yet</p>
                      </div>
                    ) : (
                      <div className="grid gap-8">
                        {history.map((item) => (
                          <div key={item.id} className="group border border-border bg-bg p-4 hover:border-accent transition-colors">
                            <div className="flex gap-4 mb-4">
                              <div className="flex-1">
                                <div className="text-[0.6rem] text-accent2 font-bold uppercase tracking-widest mb-1">
                                  {item.createdAt?.toDate().toLocaleDateString()} @ {item.createdAt?.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                </div>
                                <div className="text-[0.75rem] font-medium text-text line-clamp-2 mb-2 italic">"{item.prompt}"</div>
                                <div className="flex flex-wrap gap-1">
                                  {item.repos.map(r => (
                                    <span key={r} className="text-[0.55rem] bg-panel2 border border-border px-1.5 py-0.5 text-muted uppercase">
                                      {r}
                                    </span>
                                  ))}
                                </div>
                              </div>
                              <div className="flex flex-col gap-2">
                                <button 
                                  onClick={() => {
                                    setState(s => ({
                                      ...s,
                                      artPrompt: item.prompt,
                                      negPrompt: item.negPrompt,
                                      model: item.model,
                                      aspectRatio: item.aspectRatio,
                                      resolution: item.resolution,
                                      qualityPreset: item.qualityPreset,
                                      lighting: item.lighting,
                                      renderStyle: item.renderStyle,
                                      lastResults: item.images,
                                      fusedPrompt: item.fusedPrompt
                                    }));
                                    setIsHistoryOpen(false);
                                    setActiveTab('results');
                                  }}
                                  className="text-[0.6rem] bg-accent text-bg px-3 py-1 uppercase font-bold hover:bg-white transition-colors"
                                >
                                  Restore
                                </button>
                              </div>
                            </div>
                            <div className="grid grid-cols-4 gap-2">
                              {item.images.map((img, idx) => (
                                <div key={idx} className="aspect-square bg-panel2 border border-border overflow-hidden relative group/img">
                                  <img 
                                    src={`data:${img.mimeType};base64,${img.base64}`} 
                                    className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity"
                                    referrerPolicy="no-referrer"
                                  />
                                  <button 
                                    onClick={() => setSelectedImage({ ...img, prompt: item.prompt })}
                                    className="absolute inset-0 flex items-center justify-center bg-bg/40 opacity-0 group-hover/img:opacity-100 transition-opacity"
                                    title="View Large"
                                  >
                                    <Maximize2 className="w-4 h-4 text-white" />
                                  </button>
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <PanelGroup direction="vertical" className="flex-1">
              {/* Vibe Bar / Prompt Window */}
              <Panel 
                defaultSize={15} 
                minSize={10} 
                maxSize={40}
                collapsible={true}
                className="flex flex-col min-h-0"
              >
                <AnimatePresence mode="wait">
                  {state.fusedPrompt ? (
                    <motion.div 
                      key="fused"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      id="vibe-bar" 
                      className="flex-1 px-6 py-4 text-[0.75rem] bg-[rgba(0,229,255,0.04)] cursor-pointer group overflow-y-auto custom-scrollbar"
                      onClick={handleSpeak}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-accent2 font-bold tracking-[0.12em] uppercase">REPO VIBE DNA</span>
                        <Volume2 className="w-4 h-4 text-accent2 opacity-50 group-hover:opacity-100 transition-opacity" />
                      </div>
                      <span className="text-text opacity-70 group-hover:opacity-100 transition-opacity leading-relaxed">{state.fusedPrompt}</span>
                    </motion.div>
                  ) : (
                    <div className="flex-1 flex items-center justify-center text-muted opacity-20 text-[0.6rem] uppercase tracking-widest">
                      Fused prompt will appear here
                    </div>
                  )}
                </AnimatePresence>
              </Panel>

              <PanelResizeHandle className="hidden md:flex h-1 bg-border hover:bg-accent transition-colors cursor-row-resize items-center justify-center group">
                <div className="h-px w-8 bg-muted/30 group-hover:bg-accent2/50" />
                <GripHorizontal className="w-3 h-3 text-muted/30 group-hover:text-accent2 absolute" />
              </PanelResizeHandle>

              {/* Image Grid / Image Window */}
              <Panel defaultSize={85} className="flex flex-col min-h-0">
                <div className={`flex-1 overflow-auto grid gap-px bg-border ${state.lastResults.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
                  {state.lastResults.length === 0 && !state.isGenerating && (
                    <div className="col-span-full flex flex-col items-center justify-center gap-4 text-muted opacity-30 h-full">
                      <div className="text-[4rem]">⬡</div>
                      <p className="text-[0.75rem] tracking-[0.15em] uppercase">select a repo, write a prompt, generate</p>
                    </div>
                  )}
                  
                  {state.isGenerating && state.lastResults.length === 0 && (
                    <div className="col-span-full flex flex-col items-center justify-center gap-4 h-full">
                      <Loader2 className="w-12 h-12 text-accent animate-spin" />
                      <p className="text-[0.75rem] tracking-[0.15em] uppercase text-accent2">{state.status}</p>
                    </div>
                  )}

                  {state.lastResults.map((img, i) => (
                    <motion.div 
                      key={i}
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      className="image-cell group"
                    >
                      <img 
                        src={`data:${img.mimeType};base64,${img.base64}`} 
                        alt={`Generated ${i + 1}`} 
                        referrerPolicy="no-referrer"
                      />
                      <div className="absolute top-2 right-2 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button 
                          onClick={() => setSelectedImage(img)}
                          className="bg-bg/80 text-text p-2 rounded-sm hover:text-accent transition-colors"
                          title="Maximize"
                        >
                          <Maximize2 className="w-4 h-4" />
                        </button>
                      </div>
                      <button 
                        onClick={() => handleExport(img, i)}
                        className="cell-export flex items-center gap-1"
                      >
                        <Download className="w-3 h-3" /> PNG
                      </button>
                    </motion.div>
                  ))}
                </div>

                {/* Export Bar */}
                <AnimatePresence>
                  {state.lastResults.length > 0 && (
                    <motion.div 
                      initial={{ y: 50, opacity: 0 }}
                      animate={{ y: 0, opacity: 1 }}
                      className="px-6 py-3 border-t border-border flex items-center gap-4 shrink-0 bg-panel"
                    >
                      <button 
                        onClick={() => state.lastResults.forEach((img, i) => setTimeout(() => handleExport(img, i), i * 300))}
                        className="bg-panel2 border border-border2 text-text text-[0.75rem] px-4 py-2 hover:border-success hover:text-success transition-colors flex items-center gap-2"
                      >
                        <Download className="w-4 h-4" /> Save All PNG
                      </button>
                      <span className="text-[0.7rem] text-muted tracking-[0.1em]">
                        {state.selectedRepos.length} Repos · {MODELS.find(m => m.id === state.model)?.name} · {state.aspectRatio} · {state.resolution}
                      </span>
                    </motion.div>
                  )}
                </AnimatePresence>
              </Panel>
            </PanelGroup>
          </Panel>
        </PanelGroup>
      </div>
    </div>
  );
}
