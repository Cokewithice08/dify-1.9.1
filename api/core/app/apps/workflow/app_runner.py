import json
import logging
import time
from typing import cast

from controllers.common.context import request_context
from core.app.apps.base_app_queue_manager import AppQueueManager
from core.app.apps.workflow.app_config_manager import WorkflowAppConfig
from core.app.apps.workflow_app_runner import WorkflowBasedAppRunner
from core.app.entities.app_invoke_entities import (
    InvokeFrom,
    WorkflowAppGenerateEntity,
)
from core.workflow.entities import GraphRuntimeState, VariablePool
from core.workflow.graph_engine.command_channels.redis_channel import RedisChannel
from core.workflow.system_variable import SystemVariable
from core.workflow.variable_loader import VariableLoader
from core.workflow.workflow_entry import WorkflowEntry
from extensions.ext_redis import redis_client
from models.enums import UserFrom
from models.workflow import Workflow
from services.gree_sso import get_redis_key, UserInfo

logger = logging.getLogger(__name__)


class WorkflowAppRunner(WorkflowBasedAppRunner):
    """
    Workflow Application Runner
    """

    def __init__(
        self,
        *,
        application_generate_entity: WorkflowAppGenerateEntity,
        queue_manager: AppQueueManager,
        variable_loader: VariableLoader,
        workflow: Workflow,
        system_user_id: str,
    ):
        super().__init__(
            queue_manager=queue_manager,
            variable_loader=variable_loader,
            app_id=application_generate_entity.app_config.app_id,
        )
        gree_data = request_context.get()
        gree_mail = gree_data.get("gree_mail")
        gree_token = gree_data.get("gree_token")
        if gree_mail:
            redis_key = get_redis_key(gree_mail)
            redis_user = redis_client.get(redis_key)
            if redis_user:
                user_info_dict = json.loads(redis_user)
                user_info = UserInfo(**user_info_dict)
                if gree_token != user_info.Token:
                    raise RuntimeError(f"The information for mail and token does not match")
        self.application_generate_entity = application_generate_entity
        self._workflow = workflow
        self._sys_user_id = system_user_id
        self._gree_mail = gree_mail
        self._gree_token = gree_token

    def run(self):
        """
        Run application
        """
        app_config = self.application_generate_entity.app_config
        app_config = cast(WorkflowAppConfig, app_config)

        # if only single iteration or single loop run is requested
        if self.application_generate_entity.single_iteration_run or self.application_generate_entity.single_loop_run:
            graph, variable_pool, graph_runtime_state = self._prepare_single_node_execution(
                workflow=self._workflow,
                single_iteration_run=self.application_generate_entity.single_iteration_run,
                single_loop_run=self.application_generate_entity.single_loop_run,
            )
        else:
            inputs = self.application_generate_entity.inputs
            files = self.application_generate_entity.files

            # Create a variable pool.

            system_inputs = SystemVariable(
                files=files,
                user_id=self._sys_user_id,
                app_id=app_config.app_id,
                workflow_id=app_config.workflow_id,
                workflow_execution_id=self.application_generate_entity.workflow_execution_id,
                gree_mail=self._gree_mail,
                gree_token=self._gree_token,
            )

            variable_pool = VariablePool(
                system_variables=system_inputs,
                user_inputs=inputs,
                environment_variables=self._workflow.environment_variables,
                conversation_variables=[],
            )

            graph_runtime_state = GraphRuntimeState(variable_pool=variable_pool, start_at=time.perf_counter())

            # init graph
            graph = self._init_graph(
                graph_config=self._workflow.graph_dict,
                graph_runtime_state=graph_runtime_state,
                workflow_id=self._workflow.id,
                tenant_id=self._workflow.tenant_id,
                user_id=self.application_generate_entity.user_id,
            )

        # RUN WORKFLOW
        # Create Redis command channel for this workflow execution
        task_id = self.application_generate_entity.task_id
        channel_key = f"workflow:{task_id}:commands"
        command_channel = RedisChannel(redis_client, channel_key)

        workflow_entry = WorkflowEntry(
            tenant_id=self._workflow.tenant_id,
            app_id=self._workflow.app_id,
            workflow_id=self._workflow.id,
            graph=graph,
            graph_config=self._workflow.graph_dict,
            user_id=self.application_generate_entity.user_id,
            user_from=(
                UserFrom.ACCOUNT
                if self.application_generate_entity.invoke_from in {InvokeFrom.EXPLORE, InvokeFrom.DEBUGGER}
                else UserFrom.END_USER
            ),
            invoke_from=self.application_generate_entity.invoke_from,
            call_depth=self.application_generate_entity.call_depth,
            variable_pool=variable_pool,
            graph_runtime_state=graph_runtime_state,
            command_channel=command_channel,
        )

        generator = workflow_entry.run()

        for event in generator:
            self._handle_event(workflow_entry, event)
