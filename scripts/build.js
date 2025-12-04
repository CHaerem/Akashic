#!/usr/bin/env node
import { execSync } from 'child_process';

// Set deploy time as ISO string
process.env.VITE_DEPLOY_TIME = new Date().toISOString();

console.log(`Building with VITE_DEPLOY_TIME=${process.env.VITE_DEPLOY_TIME}`);

// Run vite build
execSync('vite build', { stdio: 'inherit', env: process.env });
