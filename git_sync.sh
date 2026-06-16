#!/bin/bash

REPO_DIR="/root/SmartCropMonitor"

cd $REPO_DIR


git add .


if ! git diff-index --quiet HEAD; then

    echo "Changes not pushed successfully at $(date)"

else

    echo "No changes detected, skipping push."

fi
