import os

if __name__ == '__main__':
	if os.name == 'nt':
		assert(os.path.exists(os.path.expanduser("~/micromamba-bin/micromamba.exe")))
	else:
		assert(os.path.exists(os.path.expanduser("~/micromamba-bin/micromamba")))
	assert(shutil.which('micromamba') is not None)
	exit(0)