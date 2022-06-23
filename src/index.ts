import { default as defaultArgv, Flags } from '@prokopschield/argv';
import { process } from '@prokopschield/filefind';
import fs from 'fs';
import path from 'path';
import nsblob from 'nsblob';
import { cacheFn, ProceduralQueue } from 'ps-std';

export const queue_stat = new ProceduralQueue(async (dir: string) => {
	try {
		return await fs.promises.stat(dir);
	} catch (e) {
		return await fs.promises.lstat(dir);
	}
});
export const serial_stat = cacheFn(async (dir: string) => {
	return (await queue_stat.await(dir)).output;
});

export const queue_read = new ProceduralQueue((file: string) => {
	return fs.promises.readFile(file);
});
export const serial_read = async (file: string) => {
	return (await queue_read.await(file)).output;
};

export const serial_store = async (file: string) => {
	try {
		const data = await serial_read(file);

		if (data.length > nsblob.config.num.file_size_limit) {
			return undefined;
		}
		return await nsblob.store(data);
	} catch {}
};

export const readHashOf = cacheFn(async (dir: string) => {
	const stat = await serial_stat(dir);

	if (stat.isFile()) {
		return await serial_store(dir);
	} else if (stat.isDirectory()) {
		let error;
		const parts = [`<h1>Index of ${dir}/</h1>`, '<ul>'];

		const rd = await fs.promises.readdir(dir);

		await Promise.all(
			rd.map(async (filename) => {
				try {
					const file = path.resolve(dir, filename);
					const hash = await readHashOf(file);

					if (hash) {
						parts[
							2 + rd.indexOf(filename)
						] = `<li><a href="/${hash}/${filename}">${filename}</a></li>`;
					} else {
						error = `Could not store ${file}`;
					}
				} catch (error_) {
					error = error_;
				}
			})
		);

		if (error) {
			throw error;
		} else {
			parts.push('</ul>', '');

			return await nsblob.store(parts.join('\n'));
		}
	} else {
		throw `${dir} is not a file.`;
	}
});

export async function exterminate(arg: string) {
	try {
		const stat = await serial_stat(arg);

		if (stat.isDirectory()) {
			const rd = await fs.promises.readdir(arg);

			await Promise.all(
				rd.map(async (filename) => {
					try {
						await exterminate(path.resolve(arg, filename));
					} catch {}
				})
			);

			await fs.promises.rmdir(arg);
		} else {
			const hash = await readHashOf(arg);
			await fs.promises.unlink(arg);
			return hash;
		}
	} catch (error) {
		console.error(error);
	}
}

export async function main(argv: Flags = defaultArgv) {
	const node_modules_folders = new Set<string>();

	for (const dir of argv.ordered) {
		await process(dir, {
			regex: /node_modules/,
			logger: (dir) => node_modules_folders.add(dir),
			errHandler: console.error,
		});
	}

	for (const folder of node_modules_folders) {
		console.error(`Processing ${folder}`);
		try {
			console.log(`${await readHashOf(folder)} ${folder}`);
			await fs.promises.rm(folder, { recursive: true });
		} catch (error) {
			console.error(error);
		}
	}
}
