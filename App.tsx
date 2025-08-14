
import React, { useState, useCallback, useEffect, useRef } from 'react';
import { GoogleGenAI, Chat } from "@google/genai";
import { solveMcq, solveEssay } from './services/geminiService';
import type { McqInput, McqOutput, EssayOutput } from './types';
import { Loader } from './components/Loader';
import { MathIcon, SparklesIcon, GlobeIcon, PaperclipIcon, XCircleIcon, PaperPlaneIcon, SunIcon, MoonIcon, TrashIcon, ExclamationTriangleIcon, CameraIcon } from './components/Icons';
import { translations, languageList, isRtl } from './i18n/translations';

type AppMode = 'mcq' | 'essay';
type Output = (McqOutput | EssayOutput) & { rawJson?: any };
type ImageData = { preview: string; base64: string; mimeType: string };
type ChatHistoryItem = { role: 'user' | 'model'; text: string };
type Theme = 'light' | 'dark';
type HistoryItem = {
    id: string;
    mode: AppMode;
    input: {
        question_text: string;
        options: string[];
    };
    imageData?: { base64: string; mimeType: string };
    output: Output;
    timestamp: number;
};


const initialInput = {
    question_text: "",
    options: ["", "", "", ""],
    numeric_tolerance: 0.01,
};

const getChatSystemInstruction = (language: string): string => {
    const prompts: { [key: string]: string } = {
        ar: "أنت مساعد متخصص في شرح مسائل الرياضيات. مهمتك الوحيدة هي توضيح وشرح الحل المقدم للمسألة الرياضية الحالية. لا تجب على أي أسئلة خارج هذا النطاق، مثل 'من أنت؟' أو أي مواضيع معرفية عامة. إذا سُئلت عن ذلك، أجب بأدب أنك مساعد رياضيات متخصص وارفض الإجابة. ركز فقط على شرح خطوات الحل.",
        en: "You are a specialized math problem assistant. Your ONLY purpose is to clarify the provided explanation for the current math problem. Do not answer any questions outside this scope, such as 'who are you?' or any general knowledge topics. If asked, politely state that you are a specialized math assistant and decline to answer. Focus solely on explaining the solution steps.",
    };
    return prompts[language] || prompts['en']; // Default to English
};


const App: React.FC = () => {
    const [setupStep, setSetupStep] = useState<'language' | 'theme' | 'complete'>('complete');
    const [mode, setMode] = useState<AppMode>('mcq');
    const [language, setLanguage] = useState<string>(() => localStorage.getItem('mathSolverLanguage') || 'ar');
    const [isLangMenuOpen, setIsLangMenuOpen] = useState(false);
    const [theme, setTheme] = useState<Theme>(() => (document.documentElement.classList.contains('dark') ? 'dark' : 'light'));
    const [input, setInput] = useState(initialInput);
    const [imageData, setImageData] = useState<ImageData | null>(null);
    const [output, setOutput] = useState<Output | null>(null);
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);
    const [history, setHistory] = useState<HistoryItem[]>([]);
    const [isClearDataModalOpen, setIsClearDataModalOpen] = useState(false);
    
    // State for follow-up chat
    const [chat, setChat] = useState<Chat | null>(null);
    const [chatHistory, setChatHistory] = useState<ChatHistoryItem[]>([]);
    const [followUpQuestion, setFollowUpQuestion] = useState('');
    const [isChatLoading, setIsChatLoading] = useState(false);

    // State for camera
    const [isCameraOpen, setIsCameraOpen] = useState<boolean>(false);
    const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);

    const langMenuRef = useRef<HTMLDivElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const chatContainerRef = useRef<HTMLDivElement>(null);
    const videoRef = useRef<HTMLVideoElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const ai = useRef(process.env.API_KEY ? new GoogleGenAI({ apiKey: process.env.API_KEY }) : null).current;


    const t = translations[language];

    const toggleTheme = () => {
        setTheme(prev => {
            const newTheme = prev === 'light' ? 'dark' : 'light';
            localStorage.setItem('theme', newTheme);
            if (newTheme === 'dark') {
                document.documentElement.classList.add('dark');
            } else {
                document.documentElement.classList.remove('dark');
            }
            return newTheme;
        });
    };

    useEffect(() => {
        const hasVisited = localStorage.getItem('hasVisitedBefore');
        if (!hasVisited) {
            setSetupStep('language');
        }

        try {
            const savedHistory = localStorage.getItem('mathSolverHistory');
            if (savedHistory) {
                setHistory(JSON.parse(savedHistory));
            }
        } catch (error) {
            console.error("Could not load history from localStorage", error);
            localStorage.removeItem('mathSolverHistory');
        }
    }, []);

    useEffect(() => {
        try {
            localStorage.setItem('mathSolverHistory', JSON.stringify(history));
        } catch (error) {
            console.error("Could not save history to localStorage", error);
        }
    }, [history]);

    useEffect(() => {
        localStorage.setItem('mathSolverLanguage', language);
        document.documentElement.lang = language;
        document.documentElement.dir = isRtl(language) ? 'rtl' : 'ltr';
    }, [language]);
    
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (langMenuRef.current && !langMenuRef.current.contains(event.target as Node)) {
                setIsLangMenuOpen(false);
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    useEffect(() => {
        if (chatContainerRef.current) {
            chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
        }
    }, [chatHistory]);
    
    useEffect(() => {
        if (cameraStream && videoRef.current) {
            videoRef.current.srcObject = cameraStream;
        }
    }, [cameraStream]);

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        const { name, value } = e.target;
        setInput(prev => ({ ...prev, [name]: value }));
    };

    const handleOptionChange = (index: number, value: string) => {
        const newOptions = [...input.options];
        newOptions[index] = value;
        setInput(prev => ({ ...prev, options: newOptions }));
    };

    const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file && file.type.startsWith('image/')) {
            const reader = new FileReader();
            reader.onloadend = () => {
                const base64String = (reader.result as string).split(',')[1];
                if (base64String) {
                    setImageData({
                        preview: URL.createObjectURL(file),
                        base64: base64String,
                        mimeType: file.type,
                    });
                }
            };
            reader.readAsDataURL(file);
        }
        if (e.target) e.target.value = '';
    };

    const clearImage = () => {
        if (imageData && imageData.preview.startsWith('blob:')) {
            URL.revokeObjectURL(imageData.preview);
        }
        setImageData(null);
    };

    const handleOpenCamera = async () => {
        setError(null);
        if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
                setCameraStream(stream);
                setIsCameraOpen(true);
            } catch (err) {
                console.error("Error accessing camera:", err);
                setError(t.cameraError);
            }
        } else {
            setError(t.cameraError);
        }
    };
    
    const handleCloseCamera = () => {
        if (cameraStream) {
            cameraStream.getTracks().forEach(track => track.stop());
        }
        setCameraStream(null);
        setIsCameraOpen(false);
    };

    const handleCapture = () => {
        if (videoRef.current && canvasRef.current) {
            const video = videoRef.current;
            const canvas = canvasRef.current;
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            const context = canvas.getContext('2d');
            if (context) {
                context.drawImage(video, 0, 0, canvas.width, canvas.height);
                const dataUrl = canvas.toDataURL('image/jpeg');
                const base64String = dataUrl.split(',')[1];
                if (base64String) {
                    setImageData({
                        preview: dataUrl,
                        base64: base64String,
                        mimeType: 'image/jpeg',
                    });
                }
            }
            handleCloseCamera();
        }
    };

    const handleSubmit = useCallback(async (e: React.FormEvent) => {
        e.preventDefault();
        setIsLoading(true);
        setError(null);
        setOutput(null);
        setChat(null);
        setChatHistory([]);

        try {
            let result;
            const imagePayload = imageData ? { base64: imageData.base64, mimeType: imageData.mimeType } : undefined;

            if (mode === 'mcq') {
                const mcqInput: McqInput = {
                    question_text: input.question_text,
                    options: input.options.filter(opt => opt.trim() !== ''),
                    numeric_tolerance: input.numeric_tolerance,
                };
                result = await solveMcq(mcqInput, language, imagePayload);
            } else {
                result = await solveEssay({ question_text: input.question_text }, language, imagePayload);
            }
            
            if (result.fail_reason) {
                setError(result.fail_reason);
                setOutput({ ...result });
            } else {
                const resultWithRawJson = { ...result, rawJson: result };
                setOutput(resultWithRawJson);
                
                const newHistoryItem: HistoryItem = {
                    id: `${Date.now()}-${Math.random()}`,
                    mode,
                    input: {
                        question_text: input.question_text,
                        options: mode === 'mcq' ? input.options : [],
                    },
                    imageData: imageData ? { base64: imageData.base64, mimeType: imageData.mimeType } : undefined,
                    output: resultWithRawJson,
                    timestamp: Date.now(),
                };
                setHistory(prev => [newHistoryItem, ...prev].slice(0, 50));

                if (result.explanation && ai) {
                    const systemInstruction = getChatSystemInstruction(language);
                    const initialHistory = [
                        { role: 'user' as const, parts: [{ text: `The question was: ${input.question_text || 'from an image'}. The options were: ${mode === 'mcq' ? input.options.join(', ') : 'N/A'}` }] },
                        { role: 'model' as const, parts: [{ text: `The explanation for the answer is: ${result.explanation}` }] }
                    ];

                    const newChat = ai.chats.create({
                        model: 'gemini-2.5-flash',
                        history: initialHistory,
                        config: { systemInstruction },
                    });
                    setChat(newChat);
                }
            }

        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : "An unexpected error occurred.";
            setError(errorMessage);
        } finally {
            setIsLoading(false);
        }
    }, [input, mode, language, imageData, ai]);

    const handleFollowUpSubmit = useCallback(async (e: React.FormEvent) => {
        e.preventDefault();
        if (!followUpQuestion.trim() || !chat || isChatLoading) return;

        const question = followUpQuestion.trim();
        setFollowUpQuestion('');
        setChatHistory(prev => [...prev, { role: 'user', text: question }]);
        setIsChatLoading(true);

        try {
            const stream = await chat.sendMessageStream({ message: question });
            let currentResponse = "";
            setChatHistory(prev => [...prev, { role: 'model', text: "" }]);

            for await (const chunk of stream) {
                currentResponse += chunk.text;
                setChatHistory(prev => {
                    const newHistory = [...prev];
                    newHistory[newHistory.length - 1].text = currentResponse;
                    return newHistory;
                });
            }
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : t.errorTitle;
            setChatHistory(prev => {
                const newHistory = [...prev];
                const lastMessage = newHistory[newHistory.length - 1];
                if (lastMessage && lastMessage.role === 'model') {
                    lastMessage.text = `${t.errorTitle}: ${errorMessage}`;
                }
                return newHistory;
            });
        } finally {
            setIsChatLoading(false);
        }
    }, [chat, followUpQuestion, isChatLoading, t]);
    
    const deleteHistoryItem = (id: string) => {
        setHistory(prev => prev.filter(item => item.id !== id));
    };

    const clearHistory = () => {
        if (window.confirm(t.clearHistoryButton + "?")) {
            setHistory([]);
        }
    };
    
    const handleResetApp = () => {
        localStorage.removeItem('mathSolverHistory');
        localStorage.removeItem('mathSolverLanguage');
        localStorage.removeItem('theme');
        localStorage.removeItem('hasVisitedBefore');
        window.location.reload();
    };

    const loadHistoryItem = (item: HistoryItem) => {
        setIsLoading(false);
        setIsChatLoading(false);
        
        setMode(item.mode);
        setInput({
            question_text: item.input.question_text,
            options: [...(item.input.options || []), "", "", ""].slice(0, 4),
            numeric_tolerance: 0.01,
        });
        
        if (item.imageData) {
            setImageData({
                preview: `data:${item.imageData.mimeType};base64,${item.imageData.base64}`,
                base64: item.imageData.base64,
                mimeType: item.imageData.mimeType,
            });
        } else {
            setImageData(null);
        }

        setOutput(item.output);
        setError(item.output.fail_reason || null);

        if (item.output && !item.output.fail_reason && item.output.explanation && ai) {
            const systemInstruction = getChatSystemInstruction(language);
            const loadedQuestionText = item.input.question_text || (item.imageData ? 'from an image' : '');
            const loadedOptions = item.mode === 'mcq' ? item.input.options.join(', ') : 'N/A';
            const initialHistory = [
                { role: 'user' as const, parts: [{ text: `The question was: ${loadedQuestionText}. The options were: ${loadedOptions}` }] },
                { role: 'model' as const, parts: [{ text: `The explanation for the answer is: ${item.output.explanation}` }] }
            ];

            const newChat = ai.chats.create({
                model: 'gemini-2.5-flash',
                history: initialHistory,
                config: { systemInstruction },
            });
            setChat(newChat);
        } else {
            setChat(null);
        }

        setChatHistory([]);
        setFollowUpQuestion('');
        
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const handleLanguageSelect = (selectedLang: string) => {
        setLanguage(selectedLang);
        setSetupStep('theme');
    };
    
    const handleThemeSelect = (selectedTheme: Theme) => {
        setTheme(selectedTheme);
        localStorage.setItem('theme', selectedTheme);
        if (selectedTheme === 'dark') {
            document.documentElement.classList.add('dark');
        } else {
            document.documentElement.classList.remove('dark');
        }
        localStorage.setItem('hasVisitedBefore', 'true');
        setSetupStep('complete');
    };

    if (setupStep === 'language') {
        return (
            <div className="fixed inset-0 bg-gray-100 dark:bg-gray-900 z-50 flex flex-col items-center justify-center p-4">
                <div className="text-center mb-8">
                    <h1 className="text-3xl font-bold text-gray-800 dark:text-white">Choose Your Language</h1>
                </div>
                <div className="w-full max-w-4xl max-h-[70vh] overflow-y-auto bg-white dark:bg-gray-800 p-6 rounded-2xl shadow-lg border border-gray-200 dark:border-gray-700">
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                        {languageList.map(lang => (
                            <button
                                key={lang.code}
                                onClick={() => handleLanguageSelect(lang.code)}
                                className="p-4 text-center rounded-lg border-2 border-gray-200 dark:border-gray-700 hover:border-cyan-500 hover:bg-cyan-50 dark:hover:bg-cyan-900/40 transition-all duration-200 transform hover:scale-105"
                            >
                                <span className="text-lg font-semibold text-gray-700 dark:text-gray-300">{lang.name}</span>
                            </button>
                        ))}
                    </div>
                </div>
                 <div className="text-center text-gray-500 dark:text-gray-500 text-xs mt-8">
                    <p>Designed by Fares Ali</p>
                    <p>Contact: Faresaligamal0@gmail.com</p>
                </div>
            </div>
        );
    }
    
    if (setupStep === 'theme') {
        const t_setup = translations[language];
        return (
             <div className="fixed inset-0 bg-gray-100 dark:bg-gray-900 z-50 flex flex-col items-center justify-center p-4 transition-colors duration-300">
                <div className="text-center mb-12">
                    <h1 className="text-3xl font-bold text-gray-800 dark:text-white">{t_setup.chooseYourTheme}</h1>
                </div>
                <div className="flex flex-col sm:flex-row gap-8">
                    <button
                        onClick={() => handleThemeSelect('light')}
                        className="flex flex-col items-center justify-center gap-4 w-48 h-48 bg-white rounded-2xl shadow-lg border-2 border-gray-200 hover:border-cyan-500 hover:shadow-xl transition-all duration-300 transform hover:scale-105"
                    >
                        <SunIcon className="w-16 h-16 text-yellow-500" />
                        <span className="text-2xl font-semibold text-gray-700">Light</span>
                    </button>
                    <button
                        onClick={() => handleThemeSelect('dark')}
                        className="flex flex-col items-center justify-center gap-4 w-48 h-48 bg-gray-800 rounded-2xl shadow-lg border-2 border-gray-700 hover:border-cyan-500 hover:shadow-xl transition-all duration-300 transform hover:scale-105"
                    >
                        <MoonIcon className="w-16 h-16 text-blue-400" />
                        <span className="text-2xl font-semibold text-gray-200">Dark</span>
                    </button>
                </div>
                 <div className="text-center text-gray-500 dark:text-gray-500 text-xs mt-12">
                    <p>{t_setup.designedBy} Fares Ali</p>
                    <p>{t_setup.contactSupport}: Faresaligamal0@gmail.com</p>
                </div>
            </div>
        )
    }

    const renderOutput = () => {
        if (isLoading) return <Loader text={t.processingButton} />;
        if (error && !output?.explanation) return (
            <div className="text-center text-red-800 dark:text-red-400 bg-red-100 dark:bg-red-900/30 p-4 rounded-lg">
                <h3 className="font-bold text-lg mb-2">{t.errorTitle}</h3>
                <p>{error}</p>
            </div>
        );
        if (!output) return (
            <div className="text-center text-gray-500 dark:text-gray-500">
                <p>{t.resultsWillBeDisplayedHere}</p>
            </div>
        );
        
        return (
            <div className="flex flex-col h-full">
                <div className="flex-grow overflow-y-auto pr-2">
                    <h2 className="text-2xl font-bold mb-4 text-center text-gray-700 dark:text-gray-300">{t.resultsTitle}</h2>
                    
                    {error && (
                         <div className="mb-4 text-center text-yellow-800 dark:text-yellow-400 bg-yellow-100 dark:bg-yellow-900/30 p-4 rounded-lg">
                            <h3 className="font-bold text-lg mb-2">{t.errorTitle}</h3>
                            <p>{error}</p>
                        </div>
                    )}
                    
                    {!output.fail_reason && (
                        <>
                            <div className="mb-6">
                                <h3 className="text-lg font-semibold text-gray-600 dark:text-gray-400 mb-2">{t.answerTitle}</h3>
                                {mode === 'mcq' && 'answer_index' in output ? (
                                    <div className="space-y-2">
                                        {input.options.map((option, index) => (
                                            <div key={index} className={`p-3 rounded-lg border-2 transition-all ${
                                                index === output.answer_index
                                                ? 'bg-green-100 dark:bg-green-800/50 border-green-500 shadow-lg scale-105'
                                                : 'bg-gray-50 dark:bg-gray-700/50 border-gray-200 dark:border-gray-600'
                                            }`}>
                                                <span className={`font-bold ${index === output.answer_index ? 'text-green-800 dark:text-green-300' : 'text-gray-800 dark:text-gray-300'}`}>
                                                    {option}
                                                </span>
                                            </div>
                                        ))}
                                        {output.answer_index === -1 && <p className="text-yellow-500 dark:text-yellow-400 mt-2">{t.couldNotDetermineAnswer}</p>}
                                    </div>
                                ) : 'answer' in output ? (
                                    <div className="p-3 rounded-lg bg-cyan-50 dark:bg-cyan-900/50 border border-cyan-400 dark:border-cyan-700">
                                    <p className="text-cyan-800 dark:text-cyan-200">{output.answer}</p>
                                    </div>
                                ) : null}
                            </div>

                            {output.explanation && (
                                <div className="mb-6">
                                    <h3 className="text-lg font-semibold text-gray-600 dark:text-gray-400 mb-2">{t.explanationTitle}</h3>
                                    <div className="p-4 rounded-lg bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700">
                                    <p className="text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{output.explanation}</p>
                                    </div>
                                </div>
                            )}

                            {chat && (
                                <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
                                    <h3 className="text-lg font-semibold text-gray-600 dark:text-gray-400 mb-3">{t.followUpQuestionLabel}</h3>
                                    <div ref={chatContainerRef} className="max-h-60 overflow-y-auto space-y-4 p-3 bg-gray-100 dark:bg-gray-900/70 rounded-lg mb-4">
                                        {chatHistory.map((item, index) => (
                                            <div key={index} className={`flex flex-col ${item.role === 'user' ? 'items-end' : 'items-start'}`}>
                                                <div className={`max-w-xl p-3 rounded-xl whitespace-pre-wrap ${item.role === 'user' ? 'bg-blue-600 text-white' : 'bg-gray-200 dark:bg-gray-700/80 text-gray-900 dark:text-gray-200'}`}>
                                                <p>{item.text}</p>
                                                </div>
                                            </div>
                                        ))}
                                        {isChatLoading && chatHistory[chatHistory.length -1]?.role === 'user' && (
                                            <div className="flex items-start">
                                                <div className="p-3 rounded-xl bg-gray-200 dark:bg-gray-700/80">
                                                    <div className="flex items-center gap-2">
                                                        <span className="w-2 h-2 bg-gray-400 rounded-full animate-pulse delay-75"></span>
                                                        <span className="w-2 h-2 bg-gray-400 rounded-full animate-pulse delay-150"></span>
                                                        <span className="w-2 h-2 bg-gray-400 rounded-full animate-pulse delay-300"></span>
                                                    </div>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                    <form onSubmit={handleFollowUpSubmit} className="flex gap-2">
                                        <input
                                            type="text"
                                            value={followUpQuestion}
                                            onChange={(e) => setFollowUpQuestion(e.target.value)}
                                            placeholder={t.followUpPlaceholder}
                                            className="flex-grow bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg p-2.5 text-gray-900 dark:text-white focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500 transition-colors"
                                            disabled={isChatLoading}
                                        />
                                        <button type="submit" disabled={isChatLoading || !followUpQuestion.trim()} className="p-2.5 bg-cyan-600 text-white rounded-lg disabled:bg-gray-400 dark:disabled:bg-gray-600 disabled:cursor-not-allowed hover:bg-cyan-700 transition-colors">
                                            <PaperPlaneIcon className="w-6 h-6" />
                                        </button>
                                    </form>
                                </div>
                            )}
                        </>
                    )}
                </div>

                {output.rawJson && (
                     <div className="mt-auto pt-4">
                        <details>
                            <summary className="cursor-pointer text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors">{t.viewRawJson}</summary>
                            <div className="mt-2 bg-gray-50 dark:bg-gray-900 p-4 rounded-lg font-mono text-sm text-cyan-800 dark:text-cyan-300 whitespace-pre-wrap overflow-x-auto border border-gray-200 dark:border-gray-700 max-h-40">
                                <code className="break-all">
                                    {JSON.stringify(output.rawJson, null, 2)}
                                </code>
                            </div>
                        </details>
                    </div>
                )}
            </div>
        )
    }
    
    const renderHistory = () => {
        return (
            <section className="mt-8">
                <div className="bg-white dark:bg-gray-800 p-6 rounded-2xl shadow-lg border border-gray-200 dark:border-gray-700">
                    <div className="flex justify-between items-center mb-4">
                        <h2 className="text-2xl font-bold text-gray-700 dark:text-gray-300">{t.historyTitle}</h2>
                        <div className="flex items-center gap-2">
                            {history.length > 0 && (
                                <button 
                                    onClick={clearHistory} 
                                    className="flex items-center gap-2 text-sm text-yellow-600 hover:text-yellow-800 dark:text-yellow-500 dark:hover:text-yellow-400 font-semibold p-2 rounded-lg hover:bg-yellow-100 dark:hover:bg-yellow-800/20 transition-colors"
                                    aria-label={t.clearHistoryButton}
                                >
                                    <TrashIcon className="w-4 h-4" />
                                    <span>{t.clearHistoryButton}</span>
                                </button>
                            )}
                            <button
                                onClick={() => setIsClearDataModalOpen(true)}
                                className="flex items-center gap-2 text-sm text-red-600 hover:text-red-800 dark:text-red-500 dark:hover:text-red-400 font-semibold p-2 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors"
                                aria-label={t.resetAppButton}
                            >
                                <ExclamationTriangleIcon className="w-4 h-4" />
                                <span>{t.resetAppButton}</span>
                            </button>
                        </div>
                    </div>
                    <div className="max-h-96 overflow-y-auto space-y-3 pe-2">
                        {history.length === 0 ? (
                            <p className="text-center text-gray-500 py-8">{t.noHistory}</p>
                        ) : (
                            history.map(item => (
                                <div key={item.id} className="p-3 bg-gray-50 dark:bg-gray-900/50 rounded-lg flex items-center justify-between gap-3 hover:bg-gray-100 dark:hover:bg-gray-700/50 transition-colors">
                                    <div className="flex-grow overflow-hidden cursor-pointer" onClick={() => loadHistoryItem(item)} aria-label={t.loadHistoryItemLabel}>
                                        <p className="text-sm font-semibold text-gray-800 dark:text-gray-200 truncate">
                                            {item.input.question_text || (item.imageData && t.questionWithImage) || 'Untitled'}
                                        </p>
                                        <div className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-2 mt-1">
                                            <span className={`font-mono px-1.5 py-0.5 rounded text-xs ${item.mode === 'mcq' ? 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200' : 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200'}`}>{item.mode === 'mcq' ? t.historyItemMCQ : t.historyItemEssay}</span>
                                            <span className="text-gray-300 dark:text-gray-600">•</span>
                                            <span>{new Date(item.timestamp).toLocaleString(language, { day: 'numeric', month: 'short', hour: 'numeric', minute: 'numeric' })}</span>
                                        </div>
                                    </div>
                                    <button 
                                        onClick={(e) => { e.stopPropagation(); deleteHistoryItem(item.id); }} 
                                        aria-label={t.deleteHistoryItemLabel}
                                        className="flex-shrink-0 p-2 text-gray-400 hover:text-red-500 rounded-full hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                                    >
                                        <TrashIcon className="w-5 h-5" />
                                    </button>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            </section>
        );
    };
    
    const renderCameraModal = () => (
        isCameraOpen && (
            <div className="fixed inset-0 bg-black bg-opacity-75 backdrop-blur-sm z-50 flex flex-col items-center justify-center p-4" role="dialog" aria-modal="true">
                <video ref={videoRef} autoPlay playsInline className="w-full max-w-3xl max-h-[70vh] rounded-lg shadow-lg border-2 border-gray-600"></video>
                <canvas ref={canvasRef} className="hidden"></canvas>
                <div className="absolute bottom-10 flex items-center justify-center w-full">
                    <button
                        type="button"
                        onClick={handleCapture}
                        className="w-20 h-20 rounded-full bg-white p-1.5 flex items-center justify-center transition-transform active:scale-95"
                        aria-label={t.capture}
                    >
                         <div className="w-full h-full rounded-full bg-white ring-4 ring-inset ring-gray-400 hover:bg-gray-200"></div>
                    </button>
                </div>
                 <button
                    type="button"
                    onClick={handleCloseCamera}
                    className="absolute top-4 end-4 p-2 rounded-full bg-black/50 text-white hover:bg-black/70 transition-colors"
                    aria-label={t.closeCamera}
                >
                    <XCircleIcon className="w-8 h-8"/>
                </button>
            </div>
        )
    );

    return (
        <div className="min-h-screen text-gray-800 dark:text-gray-200 flex flex-col items-center p-4 sm:p-6 lg:p-8 font-sans">
             {renderCameraModal()}
             {isClearDataModalOpen && (
                <div className="fixed inset-0 bg-black bg-opacity-60 backdrop-blur-sm z-50 flex items-center justify-center p-4" aria-modal="true" role="dialog">
                    <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl p-6 sm:p-8 w-full max-w-md text-center border border-gray-200 dark:border-gray-700">
                        <ExclamationTriangleIcon className="w-12 h-12 text-red-500 mx-auto mb-4" />
                        <h2 className="text-2xl font-bold text-gray-800 dark:text-white mb-3">{t.clearDataConfirmationTitle}</h2>
                        <p className="text-gray-600 dark:text-gray-300 mb-8">{t.clearDataConfirmationMessage}</p>
                        <div className="flex flex-col sm:flex-row justify-center gap-4">
                            <button
                                onClick={() => setIsClearDataModalOpen(false)}
                                className="w-full sm:w-auto px-6 py-2.5 rounded-lg bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 font-semibold hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
                            >
                                {t.cancelButton}
                            </button>
                            <button
                                onClick={handleResetApp}
                                className="w-full sm:w-auto px-6 py-2.5 rounded-lg bg-red-600 text-white font-semibold hover:bg-red-700 transition-colors"
                            >
                                {t.confirmButton}
                            </button>
                        </div>
                    </div>
                </div>
            )}
            <div className="w-full max-w-6xl mx-auto">
                <header className="text-center mb-8 relative">
                    <div className="flex items-center justify-center gap-4 mb-2">
                        <MathIcon className="w-10 h-10 text-cyan-400" />
                        <h1 className="text-4xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-blue-500">
                            {t.title}
                        </h1>
                    </div>
                    <p className="text-gray-500 dark:text-gray-400">{t.subtitle}</p>
                     <div className="absolute top-0 end-0 flex items-center space-x-1 sm:space-x-2">
                        <button
                            onClick={toggleTheme}
                            className="p-2 rounded-full text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                            aria-label="Toggle theme"
                        >
                            {theme === 'light' ? <MoonIcon className="w-6 h-6" /> : <SunIcon className="w-6 h-6 text-yellow-400" />}
                        </button>
                        <div ref={langMenuRef} className="relative">
                            <button onClick={() => setIsLangMenuOpen(p => !p)} className="p-2 rounded-full hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors" aria-label="Change language">
                                <GlobeIcon className="w-6 h-6 text-gray-500 dark:text-gray-400"/>
                            </button>
                            {isLangMenuOpen && (
                                <div className="absolute top-full mt-2 end-0 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl w-48 max-h-72 overflow-y-auto z-10">
                                    {languageList.map(lang => (
                                        <button 
                                            key={lang.code}
                                            onClick={() => { setLanguage(lang.code); setIsLangMenuOpen(false); }}
                                            className={`w-full text-start p-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 ${language === lang.code ? 'bg-cyan-100 dark:bg-cyan-800 font-semibold text-cyan-900 dark:text-white' : 'text-gray-700 dark:text-gray-300'}`}
                                        >
                                            {lang.name}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                </header>

                <main className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                    <div className="bg-white dark:bg-gray-800 p-6 rounded-2xl shadow-lg border border-gray-200 dark:border-gray-700 flex flex-col">
                        <form onSubmit={handleSubmit} className="flex-grow flex flex-col">
                           <div className="flex-grow">
                                <div className="flex items-center justify-center mb-6 bg-gray-100 dark:bg-gray-900 rounded-lg p-1">
                                    <button type="button" onClick={() => setMode('mcq')} className={`w-1/2 p-2 rounded-md font-semibold transition-colors ${mode === 'mcq' ? 'bg-cyan-600 text-white shadow-md' : 'text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'}`}>{t.mcqMode}</button>
                                    <button type="button" onClick={() => setMode('essay')} className={`w-1/2 p-2 rounded-md font-semibold transition-colors ${mode === 'essay' ? 'bg-cyan-600 text-white shadow-md' : 'text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'}`}>{t.essayMode}</button>
                                </div>

                                <div className="space-y-6">
                                    <div>
                                        <label htmlFor="question_text" className="block text-lg font-medium text-gray-700 dark:text-gray-300 mb-2">
                                            {mode === 'mcq' ? t.questionLabelMcq : t.questionLabelEssay}
                                        </label>
                                        <textarea
                                            id="question_text"
                                            name="question_text"
                                            rows={mode === 'mcq' ? 3 : 7}
                                            className="w-full bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg p-3 text-gray-900 dark:text-white focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500 transition-all"
                                            value={input.question_text}
                                            onChange={handleInputChange}
                                            placeholder={t.questionPlaceholder}
                                        />
                                    </div>
                                    
                                    <div className="text-center">
                                        {!imageData ? (
                                            <>
                                                <div className="flex items-center justify-center my-2">
                                                    <hr className="w-full border-gray-300 dark:border-gray-600" />
                                                    <span className="px-2 text-sm text-gray-400 dark:text-gray-500 uppercase">{t.or}</span>
                                                    <hr className="w-full border-gray-300 dark:border-gray-600" />
                                                </div>
                                                <div className="space-y-3">
                                                    <button
                                                        type="button"
                                                        onClick={handleOpenCamera}
                                                        className="w-full flex items-center justify-center gap-2 border-2 border-dashed border-gray-300 dark:border-gray-600 hover:border-cyan-500 text-gray-500 dark:text-gray-400 hover:text-cyan-400 font-semibold py-3 px-4 rounded-lg transition-colors duration-300"
                                                    >
                                                        <CameraIcon className="w-5 h-5" />
                                                        {t.takePicture}
                                                    </button>
                                                    <input
                                                        type="file"
                                                        ref={fileInputRef}
                                                        onChange={handleImageChange}
                                                        className="hidden"
                                                        accept="image/*"
                                                    />
                                                    <button
                                                        type="button"
                                                        onClick={() => fileInputRef.current?.click()}
                                                        className="w-full flex items-center justify-center gap-2 border-2 border-dashed border-gray-300 dark:border-gray-600 hover:border-cyan-500 text-gray-500 dark:text-gray-400 hover:text-cyan-400 font-semibold py-3 px-4 rounded-lg transition-colors duration-300"
                                                    >
                                                        <PaperclipIcon className="w-5 h-5" />
                                                        {t.uploadImagePrompt}
                                                    </button>
                                                </div>
                                            </>
                                        ) : (
                                            <div className="mt-2 relative">
                                                <p className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-2 text-start">{t.imagePreview}</p>
                                                <img src={imageData.preview} alt={t.imagePreview} className="rounded-lg max-h-40 w-auto shadow-md" />
                                                <button
                                                    type="button"
                                                    onClick={clearImage}
                                                    className="absolute top-0 end-0 mt-1 me-1 bg-black/60 text-white rounded-full p-1 hover:bg-black/80 transition-opacity"
                                                    aria-label={t.clearImage}
                                                >
                                                    <XCircleIcon className="w-6 h-6" />
                                                </button>
                                            </div>
                                        )}
                                    </div>

                                    {mode === 'mcq' && (
                                    <div>
                                        <label className="block text-lg font-medium text-gray-700 dark:text-gray-300 mb-2">
                                            {t.optionsLabel}
                                        </label>
                                        <div className="space-y-3">
                                            {input.options.map((option, index) => (
                                                <div key={index} className="flex items-center">
                                                    <span className="bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400 rounded-s-lg px-3 py-2.5">{index + 1}</span>
                                                    <input
                                                        type="text"
                                                        className="w-full bg-gray-50 dark:bg-gray-900 border border-s-0 border-gray-300 dark:border-gray-600 rounded-e-lg p-2.5 text-gray-900 dark:text-white focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500 transition-colors"
                                                        value={option}
                                                        onChange={(e) => handleOptionChange(index, e.target.value)}
                                                        placeholder={`${t.optionPlaceholder} ${index + 1}`}
                                                    />
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                    )}
                                </div>
                            </div>
                            <div className="mt-8">
                                <button
                                    type="submit"
                                    disabled={isLoading}
                                    className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700 text-white font-bold py-3 px-4 rounded-lg shadow-md transition-all duration-300 ease-in-out disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    {isLoading ? t.processingButton : t.solveButton}
                                    {!isLoading && <SparklesIcon className="w-5 h-5" />}
                                </button>
                                <div className="text-center text-gray-500 dark:text-gray-500 text-xs mt-4">
                                    <p> {t.designedBy} Fares Ali</p>
                                    <p>{t.contactSupport}: Faresaligamal0@gmail.com</p>
                                </div>
                            </div>
                        </form>
                    </div>

                    <div className="bg-white dark:bg-gray-800 p-6 rounded-2xl shadow-lg border border-gray-200 dark:border-gray-700 flex flex-col justify-between min-h-[500px]">
                        {renderOutput()}
                    </div>
                </main>
                
                {renderHistory()}
            </div>
        </div>
    );
};

export default App;
