// SPDX-FileCopyrightText: 2022 The CC: Tweaked Developers
//
// SPDX-License-Identifier: MPL-2.0

package cc.tweaked.gradle

import org.gradle.api.file.DirectoryProperty
import org.gradle.api.file.FileSystemOperations
import org.gradle.api.tasks.AbstractExecTask
import org.gradle.api.tasks.OutputDirectory
import javax.inject.Inject

abstract class ExecToDir : AbstractExecTask<ExecToDir>(ExecToDir::class.java) {
    @get:OutputDirectory
    abstract val output: DirectoryProperty

    @get:Inject
    protected abstract val fileSystemOperations: FileSystemOperations

    /** The command writes the whole directory, so start from an empty one: files it no longer writes must not stay. */
    override fun exec() {
        fileSystemOperations.delete { delete(output) }
        output.get().asFile.mkdirs()
        super.exec()
    }
}
