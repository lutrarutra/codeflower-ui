import { mount } from 'svelte';
import '../chat/app.css';
import './web.css';
import Shell from './Shell.svelte';
import { app } from './lib/app.svelte.ts';
import { takePageKey } from './lib/pageKey.ts';

// First: the key leaves the address before anything reads or shows it.
takePageKey();

// The page follows the system's light or dark setting, also when it changes.
const dark = window.matchMedia('(prefers-color-scheme: dark)');
const syncTheme = () => document.body.classList.toggle('cf-dark', dark.matches);
syncTheme();
dark.addEventListener('change', syncTheme);

const target = document.getElementById('app');
if (!target) throw new Error('The page root element is missing');
mount(Shell, { target });
app.start();
